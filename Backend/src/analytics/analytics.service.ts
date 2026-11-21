import { BadGatewayException, BadRequestException, Injectable, Logger } from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import { SecretBox } from "../common/crypto/secret-box";
import { PrismaService } from "../prisma/prisma.service";
import {
  MetaGraph,
  MetaRequestError,
  MetaTransportError,
  type PricingPoint,
  type WabaAnalyticsPoint,
} from "../whatsapp/meta-graph";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type {
  AnalyticsHour,
  AnalyticsOverview,
  AnalyticsPoint,
  AnalyticsPricing,
  AnalyticsTotals,
} from "./analytics.view";

/** The window every headline figure covers. */
const WINDOW_DAYS = 28;
const DAY_SECONDS = 86_400;

/**
 * How long one workspace's answer is reused. Meta's analytics lag by minutes,
 * so a minute-old read is the same answer to the customer's eye.
 */
const CACHE_TTL_MS = 60_000;

/** A cached answer is dropped once it is this old, so restarts are the only leak. */
const CACHE_MAX_AGE_MS = 15 * 60_000;

const NO_TOKEN =
  "The stored access token cannot be read. Reconnect the number and try again.";

/** Product class Meta uses for messages a customer started. */
const INCOMING = [100];

/**
 * The Overview screen's data, read live from the connected Meta account.
 *
 * Nothing here is stored: analytics are a projection of Meta's own numbers,
 * and a local copy would only be a copy that drifts. The six reads are run
 * together and judged separately, because Meta answering one of them with an
 * error says nothing about the other five — a blank spend panel must not take
 * the volume trend with it. When no read succeeds at all, the last good answer
 * is served with `stale: true` rather than a screen of zeroes.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly cache = new Map<string, { at: number; payload: AnalyticsOverview }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly box: SecretBox,
    private readonly meta: MetaGraph,
    private readonly workspaces: WorkspacesService,
  ) {}

  async overview(claims: AuthClaims, refresh: boolean): Promise<AnalyticsOverview> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const cached = this.cache.get(workspaceId);

    if (!refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.payload;
    }

    const target = await this.target(workspaceId);

    if (!target) return disconnected();

    const end = Math.floor(Date.now() / 1000);
    const start = end - WINDOW_DAYS * DAY_SECONDS;
    const hourStart = end - DAY_SECONDS;

    const unavailable: string[] = [];
    let failure: unknown = null;

    const read = async <T>(label: string, work: Promise<T>): Promise<T | null> => {
      try {
        return await work;
      } catch (error) {
        unavailable.push(label);
        failure = failure ?? error;
        this.logger.warn(`Analytics read failed (${label}): ${explain(error)}`);
        return null;
      }
    };

    const [daily, inbound, hourly, hourlyInbound, monthly, pricing] = await Promise.all([
      read(
        "message volume",
        this.meta.getWabaAnalytics(target.version, target.businessAccountId, target.token, {
          start,
          end,
          granularity: "DAY",
        }),
      ),
      read(
        "inbound messages",
        this.meta.getWabaAnalytics(target.version, target.businessAccountId, target.token, {
          start,
          end,
          granularity: "DAY",
          productTypes: INCOMING,
        }),
      ),
      read(
        "hourly volume",
        this.meta.getWabaAnalytics(target.version, target.businessAccountId, target.token, {
          start: hourStart,
          end,
          granularity: "HALF_HOUR",
        }),
      ),
      read(
        "hourly inbound",
        this.meta.getWabaAnalytics(target.version, target.businessAccountId, target.token, {
          start: hourStart,
          end,
          granularity: "HALF_HOUR",
          productTypes: INCOMING,
        }),
      ),
      read(
        "monthly volume",
        this.meta.getWabaAnalytics(target.version, target.businessAccountId, target.token, {
          start,
          end,
          granularity: "MONTHLY",
        }),
      ),
      read(
        "spend",
        this.meta.getPricingAnalytics(
          target.version,
          target.businessAccountId,
          target.token,
          start,
          end,
        ),
      ),
    ]);

    // Nothing came back. A cached answer from earlier today is the honest
    // screen; without one, saying Meta refused is better than inventing zeroes.
    if (unavailable.length === 6) {
      if (cached) {
        return { ...cached.payload, stale: true, warning: explain(failure) };
      }

      throw new BadGatewayException(explain(failure));
    }

    const payload: AnalyticsOverview = {
      connected: true,
      window: { start: isoOf(start), end: isoOf(end), days: WINDOW_DAYS },
      totals: daily && inbound ? totalsOf(daily.points, inbound.points) : null,
      daily: daily ? pointsOf(daily.points) : null,
      hourly: hourly && hourlyInbound ? mergeHours(hourly.points, hourlyInbound.points) : null,
      monthly: monthly ? pointsOf(monthly.points) : null,
      pricing: pricing ? pricingOf(pricing.points) : null,
      currency: daily?.currency ?? pricing?.currency ?? null,
      unavailable,
      syncedAt: new Date().toISOString(),
      stale: unavailable.length > 0,
      warning: unavailable.length > 0 ? explain(failure) : undefined,
    };

    if (unavailable.length === 0) this.remember(workspaceId, payload);

    return payload;
  }

  private remember(workspaceId: string, payload: AnalyticsOverview): void {
    const cutoff = Date.now() - CACHE_MAX_AGE_MS;

    for (const [key, entry] of this.cache) {
      if (entry.at < cutoff) this.cache.delete(key);
    }

    this.cache.set(workspaceId, { at: Date.now(), payload });
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

  private openOrNull(cipher: string): string | null {
    try {
      return this.box.open(cipher);
    } catch {
      return null;
    }
  }
}

function disconnected(): AnalyticsOverview {
  return {
    connected: false,
    window: null,
    totals: null,
    daily: null,
    hourly: null,
    monthly: null,
    pricing: null,
    currency: null,
    unavailable: [],
    syncedAt: null,
    stale: false,
  };
}

/** Buckets Meta returned, oldest first. A bucket without a count held nothing. */
function pointsOf(points: WabaAnalyticsPoint[]): AnalyticsPoint[] {
  return points
    .filter((point) => point.start !== null)
    .sort((a, b) => (a.start as number) - (b.start as number))
    .map((point) => ({
      start: isoOf(point.start as number),
      sent: point.sent ?? 0,
      delivered: point.delivered ?? 0,
    }));
}

/**
 * Half-hour buckets from two reads with the same windows. The filtered read
 * only covers incoming, so anything it did not count is the business's own.
 */
function mergeHours(all: WabaAnalyticsPoint[], incoming: WabaAnalyticsPoint[]): AnalyticsHour[] {
  const buckets = new Map<number, AnalyticsHour>();

  for (const point of all) {
    if (point.start === null) continue;

    buckets.set(point.start, {
      start: isoOf(point.start),
      sent: point.sent ?? 0,
      inbound: 0,
    });
  }

  for (const point of incoming) {
    if (point.start === null) continue;

    const bucket = buckets.get(point.start);

    buckets.set(point.start, {
      start: isoOf(point.start),
      sent: bucket?.sent ?? point.sent ?? 0,
      inbound: point.sent ?? 0,
    });
  }

  return [...buckets.values()].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
}

function totalsOf(all: WabaAnalyticsPoint[], incoming: WabaAnalyticsPoint[]): AnalyticsTotals {
  const sent = sumOf(all, "sent");
  const delivered = sumOf(all, "delivered");
  const inbound = sumOf(incoming, "sent");

  return {
    sent,
    delivered,
    inbound,
    outbound: Math.max(0, sent - inbound),
    deliveryRate: sent > 0 ? delivered / sent : null,
  };
}

function sumOf(points: WabaAnalyticsPoint[], key: "sent" | "delivered"): number {
  return points.reduce((total, point) => total + (point[key] ?? 0), 0);
}

/** One row per pricing category, largest volume first. */
function pricingOf(points: PricingPoint[]): AnalyticsPricing[] {
  const rows = new Map<string, { volume: number; cost: number; priced: boolean }>();

  for (const point of points) {
    const category = point.category.trim().toUpperCase();
    const row = rows.get(category) ?? { volume: 0, cost: 0, priced: false };

    row.volume += point.volume ?? 0;

    if (point.cost !== null) {
      row.cost += point.cost;
      row.priced = true;
    }

    rows.set(category, row);
  }

  return [...rows.entries()]
    .map(([category, row]) => ({
      category,
      volume: row.volume,
      cost: row.priced ? row.cost : null,
    }))
    .sort((a, b) => b.volume - a.volume);
}

function isoOf(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** Meta's own sentence when it gave one, then the transport reason. */
function explain(error: unknown): string {
  if (error instanceof MetaRequestError) return error.explanation;
  if (error instanceof MetaTransportError) return error.message;

  return error instanceof Error ? error.message : "Unexpected failure.";
}
