import { BadGatewayException, BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma, type MessageTemplate } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { SecretBox } from "../common/crypto/secret-box";
import { PrismaService } from "../prisma/prisma.service";
import {
  MetaGraph,
  MetaRequestError,
  MetaTransportError,
  type MessageTemplateDetails,
} from "../whatsapp/meta-graph";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { CreateTemplateDto } from "./dto/create-template.dto";
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
      header: input.header ?? null,
      body: input.body,
      footer: input.footer ?? null,
      buttons: input.buttons ?? [],
      examples: input.examples ?? {},
    };

    const problems = problemsIn(draft);

    if (problems.length > 0) {
      throw new BadRequestException({ message: problems, code: "TEMPLATE_INVALID" });
    }

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
      },
      update: {
        metaId: created.id,
        category: draft.category,
        parameterFormat: draft.parameterFormat,
        status,
        rejectedReason: null,
        components: components as Prisma.InputJsonValue,
      },
    });

    return facts(row);
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
    version: string;
    businessAccountId: string;
    token: string;
  } | null> {
    const row = await this.prisma.whatsAppAccount.findUnique({
      where: { workspaceId },
      select: {
        graphVersion: true,
        businessAccountId: true,
        accessTokenCipher: true,
      },
    });

    if (!row) return null;

    const token = this.openOrNull(row.accessTokenCipher);

    if (!token) throw new BadRequestException(NO_TOKEN);

    return {
      version: row.graphVersion,
      businessAccountId: row.businessAccountId,
      token,
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

/** Meta's own sentence when it gave one, then the transport reason. */
function explain(error: unknown): string {
  if (error instanceof MetaRequestError) return error.explanation;
  if (error instanceof MetaTransportError) return error.message;

  return error instanceof Error ? error.message : "Unexpected failure.";
}
