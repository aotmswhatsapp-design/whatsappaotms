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

// ---------------------------------------------------------------------------
// The stored report.
//
// `AnalyticsCostState` is the whole point of these shapes: a figure is either
// something Meta reported or something Meta did not report, and there is no
// third value. An estimate would need a name of its own and none is offered.
// ---------------------------------------------------------------------------

export type AnalyticsCostState = "ACTUAL" | "UNAVAILABLE";

export interface AnalyticsTemplateStat {
  /** Meta's template id — the id every stored figure is keyed by. */
  templateId: string;
  /** Our own row, when the template was created or imported here. */
  messageTemplateId: string | null;
  name: string;
  category: string | null;
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  /** Null when Meta returned no cost for these sends. Never a stand-in zero. */
  spent: number | null;
  /** Σ spent ÷ Σ delivered, recomputed from the window rather than summed. */
  costPerDelivered: number | null;
  costPerUrlClick: number | null;
  costState: AnalyticsCostState;
  /** Days in the window that carried any activity. */
  activeDays: number;
  lastSyncedAt: string;
}

export interface AnalyticsMonthStat {
  /** `YYYY-MM`, in UTC. */
  month: string;
  sent: number;
  delivered: number;
  /** Null when no cost was reported in that month. */
  spent: number | null;
}

/**
 * One row of account-level reconciliation. Deliberately not attributable to a
 * template: this read counts every delivered message, free replies included.
 */
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
  /** False when no number is connected: the screen asks for one instead. */
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
  /**
   * The whole account's delivered volume and charge for the window, from
   * `pricing_analytics`. Shown beside the template figures, never merged into
   * them: this count includes free replies and messages sent outside any
   * template, so adding it to a template row would attribute spend to a
   * template that never sent it.
   */
  account: { volume: number; cost: number | null } | null;
  /** The first and last day Meta has answered for, across all stored days. */
  available: { first: string | null; last: string | null };
  lastSyncedAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  runs: AnalyticsRunRow[];
  /** Why a cost column is empty, in the screen's words. Null when it is not. */
  costNote: string | null;
  /** Days in the window with no snapshot at all, so a gap is never silent. */
  missingDays: number;
}
