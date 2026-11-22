import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from "@nestjs/common";
import {
  CostStatus,
  Prisma,
  SyncStatus,
  SyncTrigger,
  type AnalyticsSyncRun,
} from "@prisma/client";

import { SecretBox } from "../common/crypto/secret-box";
import type { AuthClaims } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import {
  MetaGraph,
  MetaRequestError,
  MetaTransportError,
  TEMPLATE_ANALYTICS_WINDOW_DAYS,
  TEMPLATE_IDS_PER_READ,
  type PricingDimension,
  type TemplateAnalyticsPoint,
} from "../whatsapp/meta-graph";
import { WorkspacesService } from "../workspaces/workspaces.service";

/** Meta answers `template_analytics` for ninety days, so that is the window. */
const WINDOW_DAYS = TEMPLATE_ANALYTICS_WINDOW_DAYS;

const DAY_MS = 86_400_000;

/**
 * Attempts per Meta read. Three is deliberate: Meta's transient failures are
 * usually gone by the second try, and a fourth would only make a rate limit
 * worse.
 */
const READ_ATTEMPTS = 3;
const RETRY_BASE_MS = 700;

/**
 * Bound on how many ten-template reads one run will make. Twenty batches is two
 * hundred templates, far past any real catalogue; the cap exists so a runaway
 * account cannot spend the day hammering Graph.
 */
const MAX_TEMPLATE_BATCHES = 20;

/** A run still marked RUNNING after this long lost its process, not its nerve. */
const STALE_RUN_MS = 15 * 60_000;

/**
 * The breakdown the reconciliation read asks for. `TIER` is only reported when
 * `PRICING_CATEGORY` and `COUNTRY` are present too, so all three travel
 * together.
 */
const PRICING_DIMENSIONS: PricingDimension[] = [
  "PHONE",
  "COUNTRY",
  "PRICING_TYPE",
  "PRICING_CATEGORY",
  "TIER",
];

/** The same read without the tier, for a WABA that refuses that dimension. */
const PRICING_DIMENSIONS_NO_TIER: PricingDimension[] = [
  "PHONE",
  "COUNTRY",
  "PRICING_TYPE",
  "PRICING_CATEGORY",
];

/** What a finished run reports back, so the controller can answer with it. */
export interface SyncOutcome {
  status: SyncStatus;
  windowDays: number;
  templatesRead: number;
  templateRows: number;
  pricingRows: number;
  prunedRows: number;
  costStatus: CostStatus;
  currency: string | null;
  /** The sentence the screen shows when something was refused. */
  problem: string | null;
  startedAt: string;
  finishedAt: string;
}

/** One template's totals for one day, accumulated across the read's points. */
interface TemplateDay {
  templateId: string;
  date: Date;
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  spent: number | null;
  perDelivered: number | null;
  perClicked: number | null;
  points: number;
}

/** One pricing breakdown for one day, before it is written. */
interface PricingDay {
  date: Date;
  phoneNumber: string;
  country: string;
  pricingCategory: string;
  pricingType: string;
  tier: string;
  volume: number;
  cost: number | null;
}

/**
 * Pulls Meta's cost and usage figures into the database.
 *
 * Why this exists at all, when the dashboard reads Meta live: Meta's own
 * retention is shorter than ours. `template_analytics` answers for ninety days
 * and read/click counters reset seven days after a send, so a live-only
 * projection silently rewrites history the moment nobody looks. A daily
 * snapshot keeps what Meta actually reported on the day it reported it.
 *
 * Two independent reads, judged separately:
 *
 * - `template_analytics`, ten template ids at a time, which is the only
 *   source of per-template spend;
 * - `pricing_analytics` with the full breakdown, which is account-level
 *   reconciliation and must never be presented as a per-template figure.
 *
 * Nothing here estimates. A cost Meta did not return is stored as absent with
 * `CostStatus.UNAVAILABLE`, because a `0` would be a claim that the messages
 * were free. That case is normal — a Messaging account sharing a Solution
 * Partner's credit line is never given a cost figure.
 */
@Injectable()
export class AnalyticsSyncService {
  private readonly logger = new Logger(AnalyticsSyncService.name);
  /** One run per workspace at a time; the cron and the button must not race. */
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly box: SecretBox,
    private readonly meta: MetaGraph,
    private readonly workspaces: WorkspacesService,
  ) {}

  /**
   * The Sync button's entry point. Tenancy is resolved from the caller's token,
   * never from the request, so a sync can only ever touch the caller's own
   * workspace.
   */
  async syncFor(claims: AuthClaims, trigger: SyncTrigger): Promise<SyncOutcome> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    return this.syncWorkspace(workspaceId, trigger);
  }

  /**
   * Syncs every connected account, one after another.
   *
   * Sequential on purpose: Meta rate-limits per app, and every workspace shares
   * this app's quota, so parallel runs would convert one slow account into a
   * read failure for all of them.
   */
  async syncAll(trigger: SyncTrigger): Promise<{
    workspaces: number;
    ok: number;
    failed: number;
  }> {
    const accounts = await this.prisma.whatsAppAccount.findMany({
      select: { workspaceId: true },
      orderBy: { createdAt: "asc" },
    });

    let ok = 0;
    let failed = 0;

    for (const account of accounts) {
      try {
        const outcome = await this.syncWorkspace(account.workspaceId, trigger);
        if (outcome.status === SyncStatus.FAILED) failed += 1;
        else ok += 1;
      } catch (error) {
        // A conflict means another worker already has this workspace; a broken
        // token means the account needs its owner. Neither stops the rest.
        failed += 1;
        this.logger.warn(
          `Scheduled analytics sync skipped ${account.workspaceId}: ${explain(error)}`,
        );
      }

      await pause(250);
    }

    return { workspaces: accounts.length, ok, failed };
  }

  /**
   * One workspace's run. Throws 400 when nothing is connected and 409 when a
   * run is already in flight, because both are the caller's to fix or retry.
   */
  async syncWorkspace(
    workspaceId: string,
    trigger: SyncTrigger,
  ): Promise<SyncOutcome> {
    if (this.running.has(workspaceId)) {
      throw new ConflictException(
        "An analytics sync is already running for this workspace.",
      );
    }

    const account = await this.prisma.whatsAppAccount.findUnique({
      where: { workspaceId },
      select: {
        id: true,
        graphVersion: true,
        businessAccountId: true,
        accessTokenCipher: true,
        currency: true,
        insightsEnabledAt: true,
      },
    });

    if (!account) {
      throw new BadRequestException(
        "No WhatsApp number is connected, so Meta has no analytics to report.",
      );
    }

    this.running.add(workspaceId);

    try {
      return await this.run(workspaceId, trigger, account);
    } finally {
      this.running.delete(workspaceId);
    }
  }

  /** The last few attempts, newest first, for the screen's activity line. */
  async recentRuns(workspaceId: string, take = 5): Promise<AnalyticsSyncRun[]> {
    return this.prisma.analyticsSyncRun.findMany({
      where: { workspaceId },
      orderBy: { startedAt: "desc" },
      take,
    });
  }

  private async run(
    workspaceId: string,
    trigger: SyncTrigger,
    account: {
      id: string;
      graphVersion: string;
      businessAccountId: string;
      accessTokenCipher: string;
      currency: string | null;
      insightsEnabledAt: Date | null;
    },
  ): Promise<SyncOutcome> {
    const startedAt = new Date();
    const run = await this.prisma.analyticsSyncRun.create({
      data: {
        workspaceId,
        trigger,
        status: SyncStatus.RUNNING,
        startedAt,
        windowDays: WINDOW_DAYS,
      },
    });

    await this.closeStaleRuns(workspaceId, run.id);

    const token = this.openOrNull(account.accessTokenCipher);

    if (!token) {
      return this.fail(
        run,
        workspaceId,
        "The stored access token cannot be read. Reconnect the number and sync again.",
      );
    }

    const end = Math.floor(startedAt.getTime() / 1000);
    const start = end - WINDOW_DAYS * 86_400;

    let currency = account.currency;
    const problems: string[] = [];

    try {
      const read = await this.withRetry("billing currency", () =>
        this.meta.getWabaCurrency(
          account.graphVersion,
          account.businessAccountId,
          token,
        ),
      );

      if (read && read !== currency) {
        currency = read;
        await this.prisma.whatsAppAccount.update({
          where: { workspaceId },
          data: { currency: read },
        });
      }
    } catch (error) {
      // Not fatal: every stored figure is still true, it just cannot be
      // labelled with a currency. The screen says so rather than guessing.
      problems.push(`Billing currency: ${explain(error)}`);
    }

    const catalogue = await this.prisma.messageTemplate.findMany({
      where: { workspaceId, metaId: { not: null } },
      select: { id: true, metaId: true, name: true, category: true },
    });

    const byMetaId = new Map(
      catalogue.flatMap((row) => (row.metaId ? [[row.metaId, row] as const] : [])),
    );

    let templateRows = 0;

    if (!account.insightsEnabledAt) {
      problems.push(
        "Per-template insights are off for this account, so Meta reports no template spend. Turning them on is one-way and happens on the Templates screen.",
      );
    } else if (byMetaId.size === 0) {
      problems.push(
        "No template has a Meta id yet, so Meta has nothing to report per template.",
      );
    } else {
      try {
        const written = await this.syncTemplates({
          workspaceId,
          accountId: account.id,
          wabaId: account.businessAccountId,
          version: account.graphVersion,
          token,
          start,
          end,
          currency,
          byMetaId,
        });

        templateRows = written;
      } catch (error) {
        problems.push(`Template analytics: ${explain(error)}`);
      }
    }

    let pricingRows = 0;

    try {
      pricingRows = await this.syncPricing({
        workspaceId,
        accountId: account.id,
        wabaId: account.businessAccountId,
        version: account.graphVersion,
        token,
        start,
        end,
        currency,
      });
    } catch (error) {
      problems.push(`Pricing analytics: ${explain(error)}`);
    }

    const prunedRows = await this.prune(workspaceId);

    const costStatus = await this.costStatusOf({
      workspaceId,
      pricingRows,
      templateRows,
    });

    const status =
      problems.length === 0
        ? SyncStatus.OK
        : templateRows > 0 || pricingRows > 0
          ? SyncStatus.PARTIAL
          : SyncStatus.FAILED;

    const problem = problems.length === 0 ? null : problems.join(" ");

    await this.prisma.analyticsSyncRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        templatesRead: byMetaId.size,
        templateRows,
        pricingRows,
        prunedRows,
        error: problem,
      },
    });

    await this.prisma.analyticsSyncState.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        whatsappAccountId: account.id,
        wabaId: account.businessAccountId,
        currency,
        costStatus,
        lastRunAt: startedAt,
        lastOkAt: status === SyncStatus.FAILED ? null : new Date(),
        lastError: problem,
        syncedThrough: today(),
      },
      update: {
        whatsappAccountId: account.id,
        wabaId: account.businessAccountId,
        currency,
        costStatus,
        lastRunAt: startedAt,
        ...(status === SyncStatus.FAILED ? {} : { lastOkAt: new Date() }),
        lastError: problem,
        ...(status === SyncStatus.FAILED ? {} : { syncedThrough: today() }),
      },
    });

    if (status !== SyncStatus.OK) {
      this.logger.warn(`Analytics sync ${status} for ${workspaceId}: ${problem}`);
    }

    return {
      status,
      windowDays: WINDOW_DAYS,
      templatesRead: byMetaId.size,
      templateRows,
      pricingRows,
      prunedRows,
      costStatus,
      currency,
      problem,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }

  /**
   * Per-template daily figures, ten ids per read.
   *
   * Chunking is not an optimisation: Meta refuses a read naming more than ten
   * ids, so a catalogue read as one batch answers nothing at all.
   */
  private async syncTemplates(input: {
    workspaceId: string;
    accountId: string;
    wabaId: string;
    version: string;
    token: string;
    start: number;
    end: number;
    currency: string | null;
    byMetaId: Map<string, { id: string; name: string; category: string }>;
  }): Promise<number> {
    const ids = [...input.byMetaId.keys()];
    const batches = chunk(ids, TEMPLATE_IDS_PER_READ).slice(0, MAX_TEMPLATE_BATCHES);
    const days = new Map<string, TemplateDay>();

    for (const batch of batches) {
      const read = await this.withRetry("template analytics", () =>
        this.meta.getTemplateAnalytics({
          version: input.version,
          businessAccountId: input.wabaId,
          token: input.token,
          templateIds: batch,
          start: input.start,
          end: input.end,
        }),
      );

      for (const point of read.points) {
        // A read naming several templates always names the template on the
        // point; a single-id read may omit it, which is unambiguous.
        const templateId = point.templateId ?? (batch.length === 1 ? batch[0] : null);
        const date = dateOf(point.start);

        if (!templateId || !date) continue;

        this.absorb(days, templateId, date, point);
      }
    }

    const now = new Date();
    let written = 0;

    for (const day of days.values()) {
      const template = input.byMetaId.get(day.templateId);
      const costStatus = day.spent === null ? CostStatus.UNAVAILABLE : CostStatus.ACTUAL;
      const data = {
        whatsappAccountId: input.accountId,
        wabaId: input.wabaId,
        messageTemplateId: template?.id ?? null,
        templateName: template?.name ?? day.templateId,
        category: template?.category ?? null,
        sentCount: day.sent,
        deliveredCount: day.delivered,
        readCount: day.read,
        clickedCount: day.clicked,
        amountSpent: money(day.spent),
        costPerDelivered: money(this.ratioOf(day, "delivered")),
        costPerUrlClick: money(this.ratioOf(day, "clicked")),
        currency: input.currency,
        costStatus,
        source: "META" as const,
        lastSyncedAt: now,
      };

      await this.prisma.templateDailyStat.upsert({
        where: {
          workspaceId_templateId_date: {
            workspaceId: input.workspaceId,
            templateId: day.templateId,
            date: day.date,
          },
        },
        create: {
          workspaceId: input.workspaceId,
          templateId: day.templateId,
          date: day.date,
          ...data,
        },
        update: data,
      });

      written += 1;
    }

    return written;
  }

  /**
   * Account-level reconciliation, broken down by number, country, pricing type,
   * pricing category and volume tier.
   *
   * Kept out of the per-template table on purpose: this read counts every
   * delivered message, templates and free replies alike, so summing it into a
   * template row would attribute spend to a template that did not send it.
   */
  private async syncPricing(input: {
    workspaceId: string;
    accountId: string;
    wabaId: string;
    version: string;
    token: string;
    start: number;
    end: number;
    currency: string | null;
  }): Promise<number> {
    const read = await this.withRetry("pricing analytics", () =>
      this.meta.getPricingAnalytics(
        input.version,
        input.wabaId,
        input.token,
        input.start,
        input.end,
        { granularity: "DAILY", dimensions: PRICING_DIMENSIONS },
      ),
      // A version that refuses the tier dimension still answers the rest, and
      // half a breakdown beats none.
      () =>
        this.meta.getPricingAnalytics(
          input.version,
          input.wabaId,
          input.token,
          input.start,
          input.end,
          { granularity: "DAILY", dimensions: PRICING_DIMENSIONS_NO_TIER },
        ),
    );

    const days = new Map<string, PricingDay>();

    for (const point of read.points) {
      const date = dateOf(point.start);
      if (!date) continue;

      const day: PricingDay = {
        date,
        phoneNumber: point.phoneNumber ?? "",
        country: point.country ?? "",
        pricingCategory: point.category ?? "",
        pricingType: point.pricingType ?? "",
        tier: point.tier ?? "",
        volume: point.volume ?? 0,
        cost: point.cost,
      };

      const key = [
        date.getTime(),
        day.phoneNumber,
        day.country,
        day.pricingCategory,
        day.pricingType,
        day.tier,
      ].join("|");

      const seen = days.get(key);

      if (!seen) {
        days.set(key, day);
        continue;
      }

      // Meta sometimes splits one breakdown across several points (per metric,
      // or per half-hour it rounds into a day). Volume adds; a cost figure is
      // kept only when Meta actually gave one.
      seen.volume += day.volume;
      if (day.cost !== null) {
        seen.cost = (seen.cost ?? 0) + day.cost;
      }
    }

    const now = new Date();
    let written = 0;

    for (const day of days.values()) {
      const data = {
        whatsappAccountId: input.accountId,
        wabaId: input.wabaId,
        phoneNumber: day.phoneNumber,
        country: day.country,
        pricingCategory: day.pricingCategory,
        pricingType: day.pricingType,
        tier: day.tier,
        volume: day.volume,
        cost: money(day.cost),
        currency: input.currency,
        costStatus: day.cost === null ? CostStatus.UNAVAILABLE : CostStatus.ACTUAL,
        source: "META" as const,
        lastSyncedAt: now,
      };

      await this.prisma.pricingDailyStat.upsert({
        where: {
          workspaceId_date_phoneNumber_country_pricingCategory_pricingType_tier: {
            workspaceId: input.workspaceId,
            date: day.date,
            phoneNumber: day.phoneNumber,
            country: day.country,
            pricingCategory: day.pricingCategory,
            pricingType: day.pricingType,
            tier: day.tier,
          },
        },
        create: { workspaceId: input.workspaceId, date: day.date, ...data },
        update: data,
      });

      written += 1;
    }

    return written;
  }

  /** Drops anything past Meta's own ninety-day horizon. */
  private async prune(workspaceId: string): Promise<number> {
    const cutoff = new Date(today().getTime() - WINDOW_DAYS * DAY_MS);

    const [templates, pricing] = await Promise.all([
      this.prisma.templateDailyStat.deleteMany({
        where: { workspaceId, date: { lt: cutoff } },
      }),
      this.prisma.pricingDailyStat.deleteMany({
        where: { workspaceId, date: { lt: cutoff } },
      }),
    ]);

    return templates.count + pricing.count;
  }

  /**
   * Whether Meta gave us money at all.
   *
   * UNAVAILABLE is the answer when messages were delivered but no figure came
   * back — that is the documented behaviour for an account billed through a
   * Solution Partner's credit line, and it must not be rendered as zero.
   */
  private async costStatusOf(input: {
    workspaceId: string;
    templateRows: number;
    pricingRows: number;
  }): Promise<CostStatus> {
    const [templates, pricing] = await Promise.all([
      this.prisma.templateDailyStat.count({
        where: {
          workspaceId: input.workspaceId,
          costStatus: CostStatus.ACTUAL,
        },
      }),
      this.prisma.pricingDailyStat.count({
        where: {
          workspaceId: input.workspaceId,
          costStatus: CostStatus.ACTUAL,
        },
      }),
    ]);

    return templates + pricing > 0 ? CostStatus.ACTUAL : CostStatus.UNAVAILABLE;
  }

  /** Rolls a day's points into one entry: counts add, ratios are decided later. */
  private absorb(
    days: Map<string, TemplateDay>,
    templateId: string,
    date: Date,
    point: TemplateAnalyticsPoint,
  ): void {
    const key = `${templateId}|${date.getTime()}`;
    const day =
      days.get(key) ??
      ({
        templateId,
        date,
        sent: 0,
        delivered: 0,
        read: 0,
        clicked: 0,
        spent: null,
        perDelivered: null,
        perClicked: null,
        points: 0,
      } satisfies TemplateDay);

    day.sent += point.sent ?? 0;
    day.delivered += point.delivered ?? 0;
    day.read += point.read ?? 0;
    day.clicked += point.clicked ?? 0;
    day.points += 1;

    if (point.amountSpent !== null) {
      day.spent = (day.spent ?? 0) + point.amountSpent;
    }

    if (point.costPerDelivered !== null) day.perDelivered = point.costPerDelivered;
    if (point.costPerClicked !== null) day.perClicked = point.costPerClicked;

    days.set(key, day);
  }

  /**
   * A day's cost-per-X.
   *
   * Meta's own ratio is used when it is the only thing we have, but the moment
   * a day is assembled from several points the ratio is recomputed from the
   * totals — adding ratios together would be meaningless.
   */
  private ratioOf(day: TemplateDay, over: "delivered" | "clicked"): number | null {
    const given = over === "delivered" ? day.perDelivered : day.perClicked;
    const count = over === "delivered" ? day.delivered : day.clicked;

    if (day.spent !== null && count > 0) return day.spent / count;

    return day.points === 1 ? given : null;
  }

  /**
   * One Meta read, retried on the failures that are worth retrying.
   *
   * Rate limits and Meta's transient codes are worth another try; a rejected
   * token or an unknown id is not, and retrying it would only delay the honest
   * error the screen needs to show.
   */
  private async withRetry<T>(
    label: string,
    work: () => Promise<T>,
    fallback?: () => Promise<T>,
  ): Promise<T> {
    let last: unknown = null;

    for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        last = error;

        if (!retryable(error) || attempt === READ_ATTEMPTS) break;

        this.logger.warn(
          `${label} attempt ${attempt} failed: ${explain(error)}; retrying.`,
        );

        await pause(RETRY_BASE_MS * attempt);
      }
    }

    if (fallback) {
      try {
        return await fallback();
      } catch (error) {
        last = last ?? error;
        this.logger.warn(`${label} fallback failed: ${explain(error)}`);
        throw error;
      }
    }

    throw last instanceof Error ? last : new Error(`${label} failed.`);
  }

  /**
   * A process that dies mid-run leaves its row RUNNING forever. Closing such
   * rows on the next run keeps the log readable and stops a stuck row from
   * looking like a sync that is still working.
   */
  private async closeStaleRuns(workspaceId: string, current: string): Promise<void> {
    await this.prisma.analyticsSyncRun.updateMany({
      where: {
        workspaceId,
        status: SyncStatus.RUNNING,
        id: { not: current },
        startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) },
      },
      data: {
        status: SyncStatus.FAILED,
        finishedAt: new Date(),
        error: "The sync stopped before it finished, so nothing was written.",
      },
    });
  }

  /** Records a run that could not start, so the screen has a reason to show. */
  private async fail(
    run: AnalyticsSyncRun,
    workspaceId: string,
    message: string,
  ): Promise<SyncOutcome> {
    await this.prisma.analyticsSyncRun.update({
      where: { id: run.id },
      data: { status: SyncStatus.FAILED, finishedAt: new Date(), error: message },
    });

    await this.prisma.analyticsSyncState.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        costStatus: CostStatus.UNAVAILABLE,
        lastRunAt: run.startedAt,
        lastError: message,
      },
      update: { lastRunAt: run.startedAt, lastError: message },
    });

    return {
      status: SyncStatus.FAILED,
      windowDays: WINDOW_DAYS,
      templatesRead: 0,
      templateRows: 0,
      pricingRows: 0,
      prunedRows: 0,
      costStatus: CostStatus.UNAVAILABLE,
      currency: null,
      problem: message,
      startedAt: run.startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }

  private openOrNull(cipher: string): string | null {
    try {
      return this.box.open(cipher);
    } catch {
      return null;
    }
  }
}

/** Meta's day boundary is UTC on this read; the column is a DATE. */
function dateOf(seconds: number | null): Date | null {
  if (seconds === null) return null;

  const at = new Date(seconds * 1000);
  if (Number.isNaN(at.getTime())) return null;

  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
}

/** Today at midnight UTC, which is what a DATE column stores. */
function today(): Date {
  const now = new Date();

  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * A money value at the column's precision, or null.
 *
 * Converted through a fixed-point string: `new Prisma.Decimal(0.1 + 0.2)` would
 * carry the float's tail into the row, and a stored charge has to be the charge.
 */
function money(value: number | null): Prisma.Decimal | null {
  if (value === null || !Number.isFinite(value)) return null;

  return new Prisma.Decimal(value.toFixed(6));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];

  for (let at = 0; at < items.length; at += size) {
    out.push(items.slice(at, at + size));
  }

  return out;
}

/** Meta's transient codes: unknown error, service down, throttling. */
const RETRY_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80004, 131056]);

function retryable(error: unknown): boolean {
  if (error instanceof MetaTransportError) return true;

  if (!(error instanceof MetaRequestError)) return false;

  if (error.status >= 500) return true;

  return error.code !== undefined && RETRY_CODES.has(error.code);
}

function explain(error: unknown): string {
  if (error instanceof MetaRequestError) return error.explanation;
  if (error instanceof MetaTransportError) return error.message;

  return error instanceof Error ? error.message : "Unexpected failure.";
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
