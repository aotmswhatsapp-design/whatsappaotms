import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type MessageTemplate } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { SecretBox } from "../common/crypto/secret-box";
import { MediaStorage } from "../inbox/media.storage";
import { PrismaService } from "../prisma/prisma.service";
import { defaultAccount } from "../whatsapp/default-account";
import {
  MetaGraph,
  MetaRequestError,
  MetaTransportError,
  TEMPLATE_IDS_PER_READ,
  type MessageTemplateDetails,
  type TemplateAnalyticsPoint,
} from "../whatsapp/meta-graph";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { CreateTemplateDto } from "./dto/create-template.dto";
import {
  buildSeries,
  costFacts,
  totalsByTemplate,
  totalsOf,
  type TemplateAnalyticsPayload,
  type TemplatePerformancePayload,
  type TemplatePerformanceRow,
} from "./templates.analytics";
import {
  extensionFor,
  inspectImage,
  mediaPathFor,
  pathBelongsTo,
} from "./template-media";
import { buildComponents, problemsIn, type TemplateDraft } from "./templates.payload";
import type { TemplateFacts, TemplateListPayload } from "./templates.view";

/**
 * How long the cache is trusted. Meta re-reviews templates continuously, so a
 * list read a minute ago is good enough to render; anything older asks again.
 * A create or a status webhook refreshes independently of this window.
 */
const SYNC_TTL_MS = 60_000;

const NO_TOKEN =
  "The stored access token cannot be read. Reconnect the number and try again.";

/** Meta serves ninety days at most; a month is the window the screen opens on. */
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

/**
 * Meta's ceiling on how many template ids one analytics read may name: ten.
 * This used to be a hundred, which Meta refuses outright — so every workspace
 * with more than ten templates lost the whole performance column rather than
 * part of it.
 */
const ANALYTICS_BATCH = TEMPLATE_IDS_PER_READ;

/** What Multer hands us from memory storage. */
export interface UploadedTemplateImage {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/** What the builder gets back from an upload, before the template exists. */
export interface UploadedTemplateMedia {
  path: string;
  previewUrl: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

/**
 * Templates are the one place Meta, not this API, decides what exists.
 *
 * Every read is a cache of `GET /{waba}/message_templates`, and every write is
 * a creation call whose answer we record. That direction matters: a template
 * made in WhatsApp Manager appears here without anyone importing it, and a
 * template deleted there stops being offered.
 */
@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly box: SecretBox,
    private readonly meta: MetaGraph,
    private readonly workspaces: WorkspacesService,
    private readonly storage: MediaStorage,
    private readonly config: ConfigService,
  ) {}

  async list(claims: AuthClaims, refresh: boolean): Promise<TemplateListPayload> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const rows = await this.cached(workspaceId);
    const syncedAt = latestSync(rows);
    const fresh = syncedAt !== null && Date.now() - syncedAt.getTime() < SYNC_TTL_MS;

    if (!refresh && fresh) {
      return {
        connected: true,
        templates: rows.map(facts),
        syncedAt: syncedAt.toISOString(),
        stale: false,
      };
    }

    const target = await this.target(workspaceId);

    // No number means nothing to ask Meta for. Templates made before the
    // number was disconnected stay readable rather than vanishing.
    if (!target) {
      return {
        connected: false,
        templates: rows.map(facts),
        syncedAt: null,
        stale: rows.length > 0,
      };
    }

    try {
      const { items, complete } = await this.meta.listMessageTemplates(
        target.version,
        target.businessAccountId,
        target.token,
      );

      await this.store(workspaceId, items, complete);

      const synced = await this.cached(workspaceId);
      return {
        connected: true,
        templates: synced.map(facts),
        syncedAt: new Date().toISOString(),
        stale: false,
      };
    } catch (error) {
      // A failed sync must not look like an empty account. The cache is served
      // with the reason attached, and the screen says the list may be behind.
      this.logger.warn(`Template sync failed: ${explain(error)}`);

      return {
        connected: true,
        templates: rows.map(facts),
        syncedAt: syncedAt ? syncedAt.toISOString() : null,
        stale: true,
        warning: explain(error),
      };
    }
  }

  /**
   * Submits a template to Meta and records the verdict. Validation happens
   * before the Graph call: every reason Meta would give for a malformed
   * template is one this API can state about the field that caused it.
   */
  async create(claims: AuthClaims, input: CreateTemplateDto): Promise<TemplateFacts> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const target = await this.target(workspaceId);

    if (!target) {
      throw new BadRequestException(
        "Connect a WhatsApp number before creating templates.",
      );
    }

    const draft: TemplateDraft = {
      name: input.name,
      category: input.category,
      language: input.language,
      parameterFormat: input.parameterFormat,
      headerFormat: input.headerFormat ?? "TEXT",
      header: input.header ?? null,
      mediaPath: input.mediaPath ?? null,
      body: input.body,
      footer: input.footer ?? null,
      buttons: input.buttons ?? [],
      examples: input.examples ?? {},
    };

    const problems = problemsIn(draft);

    if (problems.length > 0) {
      throw new BadRequestException({ message: problems, code: "TEMPLATE_INVALID" });
    }

    // An image travels in two steps: the draft names our stored copy, and the
    // Resumable Upload API mints the handle here, immediately before the
    // creation call. Nothing is held between requests, so no handle can be
    // stale by the time Meta reads it.
    const media =
      draft.headerFormat === "IMAGE"
        ? await this.sendImage(workspaceId, draft.mediaPath ?? "", target)
        : null;

    if (media) draft.headerHandle = media.handle;

    const components = buildComponents(draft);

    let created: { id: string; status?: string };

    try {
      created = await this.meta.createMessageTemplate(
        target.version,
        target.businessAccountId,
        target.token,
        {
          name: draft.name,
          // Meta's creation payload wants the lowercase category; the enum in
          // our own database is uppercase.
          category: draft.category.toLowerCase(),
          language: draft.language,
          parameter_format: draft.parameterFormat.toLowerCase(),
          components,
        },
      );
    } catch (error) {
      throw new BadGatewayException(explain(error));
    }

    const status = created.status?.trim() || "PENDING";

    // A resubmission as a text template must not keep the old image, or the
    // card would show a picture the message no longer sends.
    const mediaColumns = media
      ? {
          mediaPath: media.path,
          mediaMime: media.mime,
          mediaSize: media.size,
          mediaHandle: media.handle,
          mediaUploadedAt: new Date(),
        }
      : {
          mediaPath: null,
          mediaMime: null,
          mediaSize: null,
          mediaHandle: null,
          mediaUploadedAt: null,
        };

    // Upsert on name+language: a previous attempt that Meta rejected may have
    // left a row behind, and Meta treats name+language as the identity.
    const row = await this.prisma.messageTemplate.upsert({
      where: {
        workspaceId_name_language: {
          workspaceId,
          name: draft.name,
          language: draft.language,
        },
      },
      create: {
        workspaceId,
        metaId: created.id,
        name: draft.name,
        language: draft.language,
        category: draft.category,
        parameterFormat: draft.parameterFormat,
        status,
        components: components as Prisma.InputJsonValue,
        ...mediaColumns,
      },
      update: {
        metaId: created.id,
        category: draft.category,
        parameterFormat: draft.parameterFormat,
        status,
        rejectedReason: null,
        components: components as Prisma.InputJsonValue,
        ...mediaColumns,
      },
    });

    return facts(row);
  }

  /**
   * Stores the sample for an IMAGE header and answers a URL the builder can
   * paint straight away.
   *
   * The bytes reach Supabase before Meta ever sees them, because our copy is
   * the durable one: an upload handle expires in 30 days, while the card has to
   * keep showing the image. The folder is the number's verified business name
   * so the bucket is readable in the dashboard; isolation comes from the
   * workspace id in the path, which is checked again on the way back in.
   */
  async uploadMedia(
    claims: AuthClaims,
    file: UploadedTemplateImage,
    name: string | undefined,
  ): Promise<UploadedTemplateMedia> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const image = inspectImage(file.buffer);

    if (!image.ok) {
      throw new BadRequestException({
        message: [image.reason],
        code: "TEMPLATE_MEDIA_INVALID",
      });
    }

    const account = await defaultAccount(this.prisma, workspaceId, {
      verifiedName: true,
      businessName: true,
      phoneNumberId: true,
    });

    const folder =
      account?.verifiedName ??
      account?.businessName ??
      account?.phoneNumberId ??
      "workspace";

    const path = mediaPathFor({
      workspaceId,
      folder,
      name: (name ?? "").trim() || "template",
      extension: extensionFor(image.mime),
    });

    await this.storage.upload(path, file.buffer, image.mime);

    return {
      path,
      previewUrl: await this.storage.signedUrl(path),
      mime: image.mime,
      size: file.buffer.length,
      width: image.width,
      height: image.height,
    };
  }

  /**
   * A fresh signed URL for a stored sample.
   *
   * Signed per request because the link dies in five minutes: the browser gets
   * one when it needs to paint, never a stored one that is found broken
   * tomorrow. Another workspace's id answers 404 rather than 403, so template
   * ids cannot be probed.
   */
  async mediaUrl(
    claims: AuthClaims,
    id: string,
  ): Promise<{ url: string; mime: string | null }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const row = await this.prisma.messageTemplate.findFirst({
      where: { id, workspaceId },
      select: { mediaPath: true, mediaMime: true },
    });

    if (!row?.mediaPath) {
      throw new NotFoundException("That template has no sample image.");
    }

    return {
      url: await this.storage.signedUrl(row.mediaPath),
      mime: row.mediaMime,
    };
  }

  /** One row, scoped to the caller's workspace — the detail screen's header. */
  async find(claims: AuthClaims, id: string): Promise<TemplateFacts> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const row = await this.prisma.messageTemplate.findFirst({
      where: { id, workspaceId },
    });

    if (!row) throw new NotFoundException("That template does not exist.");

    return facts(row);
  }

  /**
   * One template's numbers over the last `days` days.
   *
   * Three sources, merged: Meta's per-day read (performance and cost), this
   * database's own message log (unique replies, which Meta does not publish),
   * and the connection row (whether insights were ever switched on). A Meta
   * failure keeps the local half and says which half is missing — a screen
   * that threw away local figures because a third party was slow would be
   * worse than one that admits the gap.
   */
  async analytics(
    claims: AuthClaims,
    id: string,
    requestedDays: number | undefined,
  ): Promise<TemplateAnalyticsPayload> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const row = await this.prisma.messageTemplate.findFirst({
      where: { id, workspaceId },
    });

    if (!row) throw new NotFoundException("That template does not exist.");

    const days = clampDays(requestedDays);
    const end = Math.floor(Date.now() / 1000);
    const start = end - days * 86_400;

    const target = await this.target(workspaceId);

    let points: TemplateAnalyticsPoint[] = [];
    let currency: string | null = null;
    const unavailable: string[] = [];
    let warning: string | undefined;

    if (!target || !row.metaId) {
      unavailable.push("Message performance", "Cost");
      warning = target
        ? "This template has no Meta id yet, so Meta has nothing to report for it."
        : "No WhatsApp number is connected, so Meta cannot be asked about this template.";
    } else {
      try {
        const read = await this.meta.getTemplateAnalytics({
          version: target.version,
          businessAccountId: target.businessAccountId,
          token: target.token,
          templateIds: [row.metaId],
          start,
          end,
        });

        points = read.points;
        currency = read.currency;
      } catch (error) {
        // The commonest refusal here is Meta's "insights not enabled", which
        // the screen answers with the switch rather than an error page.
        warning = explain(error);
        unavailable.push("Message performance", "Cost");
      }
    }

    const series = unavailable.length > 0 ? [] : buildSeries(points, start, end);
    const totals = totalsOf(series);
    // Without Meta's answer the counts are unknown, not zero — reporting zero
    // would say the template was never sent, which is a different claim.
    const counted = unavailable.length === 0;

    const uniqueReplies = await this.uniqueReplies(
      workspaceId,
      row.name,
      row.language,
      new Date(start * 1000),
    );

    return {
      templateId: row.id,
      templateName: row.name,
      insightsEnabled: Boolean(target?.insightsEnabledAt),
      window: {
        days,
        start: new Date(start * 1000).toISOString(),
        end: new Date(end * 1000).toISOString(),
      },
      currency,
      cost: costFacts(totals),
      performance: {
        sent: counted ? totals.sent : null,
        delivered: counted ? totals.delivered : null,
        read: counted ? totals.read : null,
        clicked: counted ? totals.clicked : null,
        uniqueReplies,
      },
      series,
      unavailable,
      ...(warning ? { warning } : {}),
    };
  }

  /**
   * Delivered count and spend for the whole catalogue, in one Graph read.
   *
   * Kept apart from `list()` on purpose: the list is a cached local read that
   * must answer even when Meta is slow or has never been asked for insights,
   * while these figures are a third-party measurement. A refusal here therefore
   * costs the two columns and a sentence, never the page.
   */
  async performance(
    claims: AuthClaims,
    requestedDays: number | undefined,
  ): Promise<TemplatePerformancePayload> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const days = clampDays(requestedDays);
    const end = Math.floor(Date.now() / 1000);
    const start = end - days * 86_400;
    const window = {
      days,
      start: new Date(start * 1000).toISOString(),
      end: new Date(end * 1000).toISOString(),
    };

    const target = await this.target(workspaceId);
    const insightsEnabled = Boolean(target?.insightsEnabledAt);

    // Only rows Meta issued an id for can be asked about; a local draft has no
    // history to measure.
    const catalogue = await this.prisma.messageTemplate.findMany({
      where: { workspaceId, metaId: { not: null }, status: { not: "DELETED" } },
      select: { id: true, metaId: true },
    });

    if (!target) {
      return {
        window,
        currency: null,
        insightsEnabled,
        rows: blankRows(catalogue),
        totals: { delivered: null, spent: null },
        unavailable: ["Delivered", "Cost"],
        warning:
          "No WhatsApp number is connected, so Meta cannot be asked for these figures.",
      };
    }

    const metaIds = catalogue.flatMap((row) => (row.metaId ? [row.metaId] : []));

    if (metaIds.length === 0) {
      return {
        window,
        currency: null,
        insightsEnabled,
        rows: [],
        totals: { delivered: null, spent: null },
        unavailable: [],
      };
    }

    const points: TemplateAnalyticsPoint[] = [];
    let currency: string | null = null;

    try {
      // Meta caps one read at ten ids; a larger catalogue takes several reads.
      for (let at = 0; at < metaIds.length; at += ANALYTICS_BATCH) {
        const read = await this.meta.getTemplateAnalytics({
          version: target.version,
          businessAccountId: target.businessAccountId,
          token: target.token,
          templateIds: metaIds.slice(at, at + ANALYTICS_BATCH),
          start,
          end,
        });

        points.push(...read.points);
        currency = currency ?? read.currency;
      }
    } catch (error) {
      // The commonest refusal is Meta's "insights not enabled", which the list
      // answers with a dash and one explanatory line.
      return {
        window,
        currency: null,
        insightsEnabled,
        rows: blankRows(catalogue),
        totals: { delivered: null, spent: null },
        unavailable: ["Delivered", "Cost"],
        warning: explain(error),
      };
    }

    const totals = totalsByTemplate(points);
    const rows: TemplatePerformanceRow[] = catalogue.map((row) => {
      const total = row.metaId ? totals.get(row.metaId) : undefined;

      return {
        templateId: row.id,
        // A template Meta has no traffic for is a measured zero, not unknown:
        // the read covered the whole window and simply found nothing.
        delivered: total ? total.delivered : 0,
        spent: total ? total.spent : null,
      };
    });

    return {
      window,
      currency,
      insightsEnabled,
      rows,
      totals: {
        delivered: rows.reduce((sum, row) => sum + (row.delivered ?? 0), 0),
        spent: rows.some((row) => row.spent !== null)
          ? rows.reduce((sum, row) => sum + (row.spent ?? 0), 0)
          : null,
      },
      unavailable: [],
    };
  }

  /**
   * Turns Meta's per-template insights on for the workspace's WABA.
   *
   * Irreversible on Meta's side, so the screen confirms first and this records
   * the stamp. Re-asking is harmless and answers the stored timestamp rather
   * than sending a second switch Meta would only accept once anyway.
   */
  async enableInsights(
    claims: AuthClaims,
  ): Promise<{ enabled: boolean; enabledAt: string }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const target = await this.target(workspaceId);

    if (!target) {
      throw new BadRequestException(
        "Connect a WhatsApp number before turning on insights.",
      );
    }

    if (target.insightsEnabledAt) {
      return {
        enabled: true,
        enabledAt: target.insightsEnabledAt.toISOString(),
      };
    }

    try {
      await this.meta.enableTemplateInsights({
        version: target.version,
        businessAccountId: target.businessAccountId,
        token: target.token,
      });
    } catch (error) {
      throw new BadGatewayException(explain(error));
    }

    const at = new Date();

    await this.prisma.whatsAppAccount.update({
      where: { id: target.id },
      data: { insightsEnabledAt: at },
    });

    return { enabled: true, enabledAt: at.toISOString() };
  }

  /**
   * Distinct conversations that replied after this template was sent.
   *
   * `Message` records the template's name and language, not its id, so the
   * join is by name — and a row written before the language was stored counts
   * too, because a missed reply is a worse error than a stray one.
   *
   * The reply has to come *after* the send. Counting every inbound message in
   * the window also counted answers to an earlier conversation, which is how
   * this figure grew larger than the number of people who actually answered.
   */
  private async uniqueReplies(
    workspaceId: string,
    name: string,
    language: string,
    since: Date,
  ): Promise<number> {
    const sentTo = await this.prisma.message.groupBy({
      by: ["conversationId"],
      where: {
        workspaceId,
        direction: "OUTBOUND",
        templateName: name,
        OR: [{ templateLanguage: language }, { templateLanguage: null }],
        createdAt: { gte: since },
      },
      _min: { createdAt: true },
    });

    // The first send in each conversation, which is the moment a reply could
    // start being an answer to this template.
    const firstSend = new Map<string, number>();
    let earliest = Number.POSITIVE_INFINITY;

    for (const row of sentTo) {
      const at = row._min.createdAt?.getTime();

      if (at === undefined) continue;

      firstSend.set(row.conversationId, at);

      if (at < earliest) earliest = at;
    }

    if (firstSend.size === 0) return 0;

    // Nothing written before the earliest send can be a reply to it, so the
    // read starts there and the per-conversation comparison finishes the job.
    const answers = await this.prisma.message.findMany({
      where: {
        workspaceId,
        direction: "INBOUND",
        conversationId: { in: [...firstSend.keys()] },
        createdAt: { gte: new Date(earliest) },
      },
      select: { conversationId: true, createdAt: true },
    });

    const answered = new Set<string>();

    for (const row of answers) {
      const sentAt = firstSend.get(row.conversationId);

      if (sentAt !== undefined && row.createdAt.getTime() >= sentAt) {
        answered.add(row.conversationId);
      }
    }

    return answered.size;
  }

  /**
   * Turns our stored sample into the handle Meta's creation call wants, using
   * the app the connection's token belongs to.
   */
  private async sendImage(
    workspaceId: string,
    path: string,
    target: { version: string; token: string; appId: string | null },
  ): Promise<{ path: string; mime: string; size: number; handle: string }> {
    if (!pathBelongsTo(path, workspaceId)) {
      throw new BadRequestException("That image belongs to another workspace.");
    }

    // Meta's Resumable Upload API is addressed by app id and refuses a token
    // minted by another app, so the connection's own id wins. META_APP_ID is
    // only the fallback for connections stored before the field existed.
    const appId =
      target.appId?.trim() ||
      (this.config.get<string>("META_APP_ID") ?? "").trim();

    if (!appId) {
      throw new ServiceUnavailableException(
        "Add the Meta App ID on the WhatsApp connection page — image headers are uploaded under it.",
      );
    }

    const bytes = await this.storage.download(path);

    // Validate the bytes being sent, not the ones the upload checked: the
    // stored object, not a claim about it, is what Meta receives.
    const image = inspectImage(bytes);

    if (!image.ok) {
      throw new BadRequestException({
        message: [image.reason],
        code: "TEMPLATE_MEDIA_INVALID",
      });
    }

    let handle: string;

    try {
      handle = await this.meta.uploadTemplateMedia({
        version: target.version,
        appId,
        token: target.token,
        bytes,
        mime: image.mime,
        fileName: path.split("/").pop() || "template",
      });
    } catch (error) {
      throw new BadGatewayException(explain(error));
    }

    return { path, mime: image.mime, size: bytes.length, handle };
  }

  /**
   * Writes Meta's answer over the cache. Matching is by name+language rather
   * than by id alone, so a row created here before Meta assigned an id is
   * adopted instead of duplicated.
   */
  private async store(
    workspaceId: string,
    items: MessageTemplateDetails[],
    complete: boolean,
  ): Promise<void> {
    const now = new Date();

    for (const item of items) {
      const name = item.name?.trim();
      const language = item.language?.trim() || "en_US";

      if (!name) continue;

      const data = {
        metaId: item.id,
        category: categoryOf(item.category),
        parameterFormat: formatOf(item),
        status: item.status?.trim() || "PENDING",
        qualityScore: qualityOf(item.quality_score),
        rejectedReason: item.rejected_reason?.trim() || null,
        components: (item.components ?? []) as Prisma.InputJsonValue,
        lastSyncedAt: now,
      };

      const existing = await this.prisma.messageTemplate.findFirst({
        where: { workspaceId, name, language },
        select: { id: true },
      });

      if (existing) {
        await this.prisma.messageTemplate.update({
          where: { id: existing.id },
          data,
        });
      } else {
        await this.prisma.messageTemplate.create({
          data: { workspaceId, name, language, ...data },
        });
      }
    }

    // Only a complete walk can say "these are all of them". A truncated list
    // would otherwise mark every template past the page cap as deleted.
    if (!complete) return;

    const present = items.map((item) => item.id);

    await this.prisma.messageTemplate.updateMany({
      where: {
        workspaceId,
        metaId: { not: null, notIn: present },
      },
      data: { status: "DELETED", lastSyncedAt: now },
    });
  }

  /**
   * The account's Graph coordinates. Null when nothing is connected; throws
   * when the stored token cannot be decrypted, because that is a broken
   * connection rather than an empty account.
   */
  private async target(workspaceId: string): Promise<{
    id: string;
    version: string;
    businessAccountId: string;
    token: string;
    appId: string | null;
    insightsEnabledAt: Date | null;
  } | null> {
    const row = await defaultAccount(this.prisma, workspaceId, {
      id: true,
      graphVersion: true,
      businessAccountId: true,
      accessTokenCipher: true,
      appId: true,
      insightsEnabledAt: true,
    });

    if (!row) return null;

    const token = this.openOrNull(row.accessTokenCipher);

    if (!token) throw new BadRequestException(NO_TOKEN);

    return {
      id: row.id,
      version: row.graphVersion,
      businessAccountId: row.businessAccountId,
      token,
      appId: row.appId,
      insightsEnabledAt: row.insightsEnabledAt,
    };
  }

  private cached(workspaceId: string): Promise<MessageTemplate[]> {
    return this.prisma.messageTemplate.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "desc" }],
    });
  }

  private openOrNull(cipher: string): string | null {
    try {
      return this.box.open(cipher);
    } catch {
      return null;
    }
  }
}

function facts(row: MessageTemplate): TemplateFacts {
  return {
    id: row.id,
    metaId: row.metaId,
    name: row.name,
    language: row.language,
    category: row.category,
    parameterFormat: row.parameterFormat,
    status: row.status,
    qualityScore: row.qualityScore,
    rejectedReason: row.rejectedReason,
    components: row.components,
    hasMedia: row.mediaPath !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function latestSync(rows: MessageTemplate[]): Date | null {
  return rows.reduce<Date | null>((latest, row) => {
    if (!row.lastSyncedAt) return latest;
    return latest === null || row.lastSyncedAt > latest ? row.lastSyncedAt : latest;
  }, null);
}

function categoryOf(raw: string | undefined): "AUTHENTICATION" | "MARKETING" | "UTILITY" {
  const value = (raw ?? "").trim().toUpperCase();

  if (value === "AUTHENTICATION" || value === "MARKETING") return value;

  // Utility is the safe assumption: it is the category Meta most often assigns
  // to an operational message, and the value is overwritten on the next sync.
  return "UTILITY";
}

/**
 * Meta sends `parameter_format` on newer versions only. When it is missing the
 * components say it themselves: a named template's examples are `*_named_params`.
 */
function formatOf(item: MessageTemplateDetails): "NAMED" | "POSITIONAL" {
  const declared = (item.parameter_format ?? "").trim().toLowerCase();

  if (declared === "named") return "NAMED";
  if (declared === "positional") return "POSITIONAL";

  return JSON.stringify(item.components ?? []).includes("named_params")
    ? "NAMED"
    : "POSITIONAL";
}

/** `quality_score` arrives as `{ score: "GREEN" }` on some versions, a string on others. */
function qualityOf(raw: MessageTemplateDetails["quality_score"]): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw.trim() || null;

  return raw.score?.trim() || null;
}

/** The same rows, with both figures unknown rather than absent from the list. */
function blankRows(catalogue: { id: string }[]): TemplatePerformanceRow[] {
  return catalogue.map((row) => ({
    templateId: row.id,
    delivered: null,
    spent: null,
  }));
}

/** Meta serves ninety days at most; anything larger is clamped, not rejected. */
function clampDays(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_DAYS;
  }

  return Math.min(MAX_DAYS, Math.max(1, Math.floor(requested)));
}

/** Meta's own sentence when it gave one, then the transport reason. */
function explain(error: unknown): string {
  if (error instanceof MetaRequestError) return error.explanation;
  if (error instanceof MetaTransportError) return error.message;

  return error instanceof Error ? error.message : "Unexpected failure.";
}
