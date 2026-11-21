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
