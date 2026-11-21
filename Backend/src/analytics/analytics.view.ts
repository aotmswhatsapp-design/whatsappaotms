/**
 * What the Overview screen reads. Every section is nullable because Meta
 * answers them in separate calls: one refusal must leave that section blank
 * instead of zeroing a figure the account never said was zero.
 */
export interface AnalyticsTotals {
  /** Everything the business sent: template and non-template. */
  sent: number;
  delivered: number;
  /** Messages customers started, from Meta's incoming product class. */
  inbound: number;
  /** `sent` minus `inbound`: the business's own outgoing messages. */
  outbound: number;
  /** delivered / sent, or null when nothing was sent in the window. */
  deliveryRate: number | null;
}

export interface AnalyticsPoint {
  start: string;
  sent: number;
  delivered: number;
}

export interface AnalyticsHour {
  start: string;
  /** All messages in the half-hour, inbound and outbound. */
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
  /** False when no number is connected: the screen asks for one instead. */
  connected: boolean;
  /** The window the figures cover, in ISO instants. */
  window: { start: string; end: string; days: number } | null;
  totals: AnalyticsTotals | null;
  /** One point per day across the window. */
  daily: AnalyticsPoint[] | null;
  /** Half-hour buckets across the last 24 hours. */
  hourly: AnalyticsHour[] | null;
  /** One point per month across the last twelve. */
  monthly: AnalyticsPoint[] | null;
  pricing: AnalyticsPricing[] | null;
  currency: string | null;
  /**
   * The reads Meta refused, in the screen's words. The rest of the payload is
   * still true; these are the parts that are missing.
   */
  unavailable: string[];
  syncedAt: string | null;
  stale: boolean;
  warning?: string;
}
