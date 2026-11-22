import { request } from "@/lib/api/http";

export { ApiError } from "@/lib/api/http";

/**
 * The Overview screen's answer, read live from the connected Meta account.
 * Every section is nullable: Meta answers each part in its own call, and a
 * section it refused must render as missing, not as zero.
 */
export interface AnalyticsTotals {
  sent: number;
  delivered: number;
  inbound: number;
  outbound: number;
  deliveryRate: number | null;
}

export interface AnalyticsPoint {
  start: string;
  sent: number;
  delivered: number;
}

export interface AnalyticsHour {
  start: string;
  sent: number;
  inbound: number;
}

export interface AnalyticsPricing {
  category: string;
  volume: number;
  /** Null when Meta reported volume without a figure for this category. */
  cost: number | null;
}

export interface AnalyticsOverview {
  connected: boolean;
  window: { start: string; end: string; days: number } | null;
  totals: AnalyticsTotals | null;
  daily: AnalyticsPoint[] | null;
  hourly: AnalyticsHour[] | null;
  monthly: AnalyticsPoint[] | null;
  pricing: AnalyticsPricing[] | null;
  currency: string | null;
  /** The reads Meta refused, in the screen's words. */
  unavailable: string[];
  syncedAt: string | null;
  stale: boolean;
  warning?: string;
}

export function fetchOverview(refresh = false): Promise<AnalyticsOverview> {
  return request<AnalyticsOverview>(
    `/v1/analytics/overview${refresh ? "?refresh=1" : ""}`,
    { method: "GET" },
  );
}

// ---------------------------------------------------------------------------
// The stored report.
//
// `AnalyticsCostState` carries the honesty rule into the browser: a figure is
// either something Meta reported or something it did not. There is no third
// value, because an estimate shown beside real charges is indistinguishable
// from them.
// ---------------------------------------------------------------------------

export type AnalyticsCostState = "ACTUAL" | "UNAVAILABLE";

export interface AnalyticsTemplateStat {
  /** Meta's template id. */
  templateId: string;
  /** Our own row, for a link to the template screen. */
  messageTemplateId: string | null;
  name: string;
  category: string | null;
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  /** Null when Meta returned no cost; never a stand-in zero. */
  spent: number | null;
  costPerDelivered: number | null;
  costPerUrlClick: number | null;
  costState: AnalyticsCostState;
  activeDays: number;
  lastSyncedAt: string;
}

export interface AnalyticsMonthStat {
  /** `YYYY-MM`. */
  month: string;
  sent: number;
  delivered: number;
  spent: number | null;
}

export interface AnalyticsPricingRow {
  phoneNumber: string;
  country: string;
  pricingCategory: string;
  pricingType: string;
  tier: string;
  volume: number;
  cost: number | null;
}

export interface AnalyticsRunRow {
  id: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  templateRows: number;
  pricingRows: number;
  error: string | null;
}

export interface AnalyticsReport {
  connected: boolean;
  currency: string | null;
  costState: AnalyticsCostState;
  window: { start: string; end: string; days: number } | null;
  totals: {
    sent: number;
    delivered: number;
    read: number;
    clicked: number;
    spent: number | null;
    costPerDelivered: number | null;
    costPerUrlClick: number | null;
    templates: number;
  } | null;
  templates: AnalyticsTemplateStat[];
  months: AnalyticsMonthStat[];
  pricing: AnalyticsPricingRow[];
  /** Whole-account figures from `pricing_analytics`, shown apart from templates. */
  account: { volume: number; cost: number | null } | null;
  available: { first: string | null; last: string | null };
  lastSyncedAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  runs: AnalyticsRunRow[];
  costNote: string | null;
  missingDays: number;
}

/** What a manual sync answers with. */
export interface SyncOutcome {
  status: "RUNNING" | "OK" | "PARTIAL" | "FAILED";
  windowDays: number;
  templatesRead: number;
  templateRows: number;
  pricingRows: number;
  prunedRows: number;
  costStatus: AnalyticsCostState;
  currency: string | null;
  problem: string | null;
  startedAt: string;
  finishedAt: string;
}

export function fetchReport(params: {
  from?: string;
  to?: string;
  category?: string;
}): Promise<AnalyticsReport> {
  const query = new URLSearchParams();

  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.category) query.set("category", params.category);

  const suffix = query.toString();

  return request<AnalyticsReport>(
    `/v1/analytics/report${suffix ? `?${suffix}` : ""}`,
    { method: "GET" },
  );
}

/** Asks the server to pull Meta's figures again. Can take a few seconds. */
export function syncAnalytics(): Promise<SyncOutcome> {
  return request<SyncOutcome>("/v1/analytics/sync", { method: "POST" });
}
