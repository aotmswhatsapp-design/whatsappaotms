import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type {
  AnalyticsCostState,
  AnalyticsMonthStat,
  AnalyticsPricingRow,
  AnalyticsReport,
  AnalyticsRunRow,
  AnalyticsTemplateStat,
} from "./analytics.view";

const DAY_MS = 86_400_000;

/** Meta keeps ninety days of template analytics, so a wider filter is a lie. */
const MAX_DAYS = 90;

/** What the screen opens on when no range is asked for. */
const DEFAULT_DAYS = 30;

/** The three categories a template can carry. Anything else is a bad filter. */
const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;

/**
 * The stored cost and usage report.
 *
 * Reads only from the snapshot tables, never from Meta: a report that quietly
 * refreshed itself would show figures that disagree with the sync timestamp
 * printed beside them, and would fail on the day Meta's ninety-day window has
 * moved past the data. The one thing this file will not do is turn an absence
 * into a zero — a template whose cost Meta withheld reports `null`, and the
 * reason travels with it.
 */
@Injectable()
export class AnalyticsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async report(
    claims: AuthClaims,
    query: { from?: string; to?: string; category?: string },
  ): Promise<AnalyticsReport> {
    const range = this.readRange(query);
    const category = this.readCategory(query.category);
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const channel = await this.prisma.whatsAppAccount.findUnique({
      where: { workspaceId },
      select: { currency: true, insightsEnabledAt: true },
    });

    if (!channel) return disconnected();

    const where = {
      workspaceId,
      date: { gte: range.from, lte: range.to },
      ...(category ? { category } : {}),
    };

    const [grouped, latest, daily, coverage, pricing, account, span, state, runs] =
      await Promise.all([
        this.prisma.templateDailyStat.groupBy({
          by: ["templateId"],
          where,
          _sum: {
            sentCount: true,
            deliveredCount: true,
            readCount: true,
            clickedCount: true,
            amountSpent: true,
          },
          _count: { _all: true },
        }),
        this.prisma.templateDailyStat.findMany({
          where,
          orderBy: [{ templateId: "asc" }, { date: "desc" }],
          distinct: ["templateId"],
          select: {
            templateId: true,
            templateName: true,
            category: true,
            messageTemplateId: true,
            lastSyncedAt: true,
          },
        }),
        this.prisma.templateDailyStat.groupBy({
          by: ["date"],
          where,
          _sum: { sentCount: true, deliveredCount: true, amountSpent: true },
        }),
        // Coverage is the account's, not the filter's: "no snapshot for these
        // days" has to stay true even when one category hides every row.
        this.prisma.templateDailyStat.groupBy({
          by: ["date"],
          where: { workspaceId, date: { gte: range.from, lte: range.to } },
          _count: { _all: true },
        }),
        this.prisma.pricingDailyStat.groupBy({
          by: [
            "phoneNumber",
            "country",
            "pricingCategory",
            "pricingType",
            "tier",
          ],
          where: { workspaceId, date: { gte: range.from, lte: range.to } },
          _sum: { volume: true, cost: true },
          orderBy: { _sum: { volume: "desc" } },
          take: 100,
        }),
        this.prisma.pricingDailyStat.aggregate({
          where: { workspaceId, date: { gte: range.from, lte: range.to } },
          _sum: { volume: true, cost: true },
        }),
        this.prisma.templateDailyStat.aggregate({
          where: { workspaceId },
          _min: { date: true },
          _max: { date: true },
        }),
        this.prisma.analyticsSyncState.findUnique({ where: { workspaceId } }),
        this.prisma.analyticsSyncRun.findMany({
          where: { workspaceId },
          orderBy: { startedAt: "desc" },
          take: 5,
        }),
      ]);

    const names = new Map(latest.map((row) => [row.templateId, row]));

    const templates: AnalyticsTemplateStat[] = grouped
      .map((row) => {
        const meta = names.get(row.templateId);
        const sent = row._sum.sentCount ?? 0;
        const delivered = row._sum.deliveredCount ?? 0;
        const clicked = row._sum.clickedCount ?? 0;
        const spent = numberOf(row._sum.amountSpent);

        return {
          templateId: row.templateId,
          messageTemplateId: meta?.messageTemplateId ?? null,
          name: meta?.templateName ?? row.templateId,
          category: meta?.category ?? null,
          sent,
          delivered,
          read: row._sum.readCount ?? 0,
          clicked,
          spent,
          // Recomputed from the window's totals. Adding Meta's daily ratios
          // would produce a number that belongs to no day at all.
          costPerDelivered:
            spent !== null && delivered > 0 ? spent / delivered : null,
          costPerUrlClick: spent !== null && clicked > 0 ? spent / clicked : null,
          costState: spent === null ? "UNAVAILABLE" : "ACTUAL",
          activeDays: row._count._all,
          lastSyncedAt: (meta?.lastSyncedAt ?? new Date()).toISOString(),
        } satisfies AnalyticsTemplateStat;
      })
      .sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));

    const totals = totalsOf(templates);
    const days = Math.round((range.to.getTime() - range.from.getTime()) / DAY_MS) + 1;

    const monthRows = monthSeries(daily);
    const costState: AnalyticsCostState =
      totals.spent !== null || pricing.some((row) => row._sum.cost !== null)
        ? "ACTUAL"
        : "UNAVAILABLE";

    const costNote = this.explainCost({
      templates: templates.length,
      pricingRows: pricing.length,
      spent: totals.spent,
      accountCost: numberOf(account._sum.cost),
      currency: channel.currency,
      insightsEnabled: channel.insightsEnabledAt !== null,
      missingDays: Math.max(0, days - coverage.length),
      days,
    });

    return {
      connected: true,
      currency: channel.currency,
      costState,
      window: {
        start: isoDay(range.from),
        end: isoDay(range.to),
        days,
      },
      totals,
      templates,
      months: monthRows,
      pricing: pricing.map(
        (row): AnalyticsPricingRow => ({
          phoneNumber: row.phoneNumber,
          country: row.country,
          pricingCategory: row.pricingCategory,
          pricingType: row.pricingType,
          tier: row.tier,
          volume: row._sum.volume ?? 0,
          cost: numberOf(row._sum.cost),
        }),
      ),
      account:
        account._sum.volume === null && account._sum.cost === null
          ? null
          : {
              volume: account._sum.volume ?? 0,
              cost: numberOf(account._sum.cost),
            },
      available: {
        first: span._min.date ? isoDay(span._min.date) : null,
        last: span._max.date ? isoDay(span._max.date) : null,
      },
      lastSyncedAt: state?.lastRunAt?.toISOString() ?? null,
      lastOkAt: state?.lastOkAt?.toISOString() ?? null,
      lastError: state?.lastError ?? null,
      runs: runs.map(
        (run): AnalyticsRunRow => ({
          id: run.id,
          trigger: run.trigger,
          status: run.status,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
          templateRows: run.templateRows,
          pricingRows: run.pricingRows,
          error: run.error,
        }),
      ),
      costNote,
      missingDays: Math.max(0, days - coverage.length),
    };
  }

  /**
   * The sentence that explains an empty cost column.
   *
   * Written here rather than in the browser so every surface tells the same
   * story, and so the reason comes from the state that produced it.
   */
  private explainCost(input: {
    templates: number;
    pricingRows: number;
    spent: number | null;
    accountCost: number | null;
    currency: string | null;
    insightsEnabled: boolean;
    missingDays: number;
    days: number;
  }): string | null {
    if (input.templates === 0 && input.pricingRows === 0) {
      return input.missingDays >= input.days
        ? "No snapshot covers these dates yet. Run Sync, or pick earlier dates — Meta itself keeps only the last ninety days."
        : "Meta reported no template activity in these dates, so there is no spend to show.";
    }

    if (input.spent === null) {
      if (!input.insightsEnabled) {
        return "Per-template insights are off for this number, so Meta reports no template spend at all. Turning them on is one-way, and the switch lives on the Templates screen.";
      }

      if (input.accountCost !== null) {
        return "Meta reported the account's total charge but no per-template cost, so the template column stays empty while the account figure below is real.";
      }

      return "Meta returned these deliveries without any cost figure. WhatsApp does not report costs to an account billed through a Solution Partner's credit line: usage arrives, charges do not. No amount is shown, because a zero would read as free.";
    }

    if (input.currency === null) {
      return "Meta reported an amount but not the billing currency for this account, so the figure is shown without a symbol rather than with a guessed one.";
    }

    return null;
  }

  /** `from`/`to` as whole UTC days, defaulting to the last thirty. */
  private readRange(query: { from?: string; to?: string }): {
    from: Date;
    to: Date;
  } {
    const to = query.to ? parseDay(query.to) : today();

    if (!to) {
      throw new BadRequestException(
        "The end of the range must be a real date, written as YYYY-MM-DD.",
      );
    }

    const from = query.from
      ? parseDay(query.from)
      : new Date(to.getTime() - (DEFAULT_DAYS - 1) * DAY_MS);

    if (!from) {
      throw new BadRequestException(
        "The start of the range must be a real date, written as YYYY-MM-DD.",
      );
    }

    if (from.getTime() > to.getTime()) {
      throw new BadRequestException("The range starts after it ends.");
    }

    const days = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;

    if (days > MAX_DAYS) {
      throw new BadRequestException(
        `A range covers at most ${MAX_DAYS} days, which is all the history Meta keeps.`,
      );
    }

    return { from, to };
  }

  private readCategory(value: string | undefined): string | null {
    if (!value) return null;

    const category = value.trim().toUpperCase();

    if (!(CATEGORIES as readonly string[]).includes(category)) {
      throw new BadRequestException(
        `Category must be one of ${CATEGORIES.join(", ")}.`,
      );
    }

    return category;
  }
}

function disconnected(): AnalyticsReport {
  return {
    connected: false,
    currency: null,
    costState: "UNAVAILABLE",
    window: null,
    totals: null,
    templates: [],
    months: [],
    pricing: [],
    account: null,
    available: { first: null, last: null },
    lastSyncedAt: null,
    lastOkAt: null,
    lastError: null,
    runs: [],
    costNote: null,
    missingDays: 0,
  };
}

/** The totals are always computed here; null only means "not connected". */
type ReportTotals = NonNullable<AnalyticsReport["totals"]>;

function totalsOf(templates: AnalyticsTemplateStat[]): ReportTotals {
  if (templates.length === 0) {
    return { sent: 0, delivered: 0, read: 0, clicked: 0, spent: null, costPerDelivered: null, costPerUrlClick: null, templates: 0 };
  }

  const sent = templates.reduce((sum, row) => sum + row.sent, 0);
  const delivered = templates.reduce((sum, row) => sum + row.delivered, 0);
  const clicked = templates.reduce((sum, row) => sum + row.clicked, 0);
  // A total exists only if some template actually reported a charge: one
  // missing figure must not be summed in as a zero.
  const priced = templates.filter((row) => row.spent !== null);
  const spent = priced.length
    ? priced.reduce((sum, row) => sum + (row.spent ?? 0), 0)
    : null;

  return {
    sent,
    delivered,
    read: templates.reduce((sum, row) => sum + row.read, 0),
    clicked,
    spent,
    costPerDelivered: spent !== null && delivered > 0 ? spent / delivered : null,
    costPerUrlClick: spent !== null && clicked > 0 ? spent / clicked : null,
    templates: templates.length,
  };
}

/** Buckets daily totals into `YYYY-MM`, oldest first. */
function monthSeries(
  rows: {
    date: Date;
    _sum: {
      sentCount: number | null;
      deliveredCount: number | null;
      amountSpent: Prisma.Decimal | null;
    };
  }[],
): AnalyticsMonthStat[] {
  const buckets = new Map<
    string,
    { sent: number; delivered: number; spent: number | null }
  >();

  for (const row of rows) {
    const month = isoDay(row.date).slice(0, 7);
    const bucket = buckets.get(month) ?? {
      sent: 0,
      delivered: 0,
      spent: null,
    };

    bucket.sent += row._sum.sentCount ?? 0;
    bucket.delivered += row._sum.deliveredCount ?? 0;

    const spent = numberOf(row._sum.amountSpent);

    if (spent !== null) bucket.spent = (bucket.spent ?? 0) + spent;

    buckets.set(month, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bucket]) => ({ month, ...bucket }));
}

/** A DECIMAL column as a plain number, or null when Meta gave nothing. */
function numberOf(value: Prisma.Decimal | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function today(): Date {
  const now = new Date();

  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** A whole UTC day, or null when the string is not one (2026-02-31 included). */
function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const at = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(at.getTime())) return null;

  return isoDay(at) === value ? at : null;
}
