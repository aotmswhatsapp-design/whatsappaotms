import type { TemplateAnalyticsPoint } from "../whatsapp/meta-graph";

/**
 * What one template's performance screen renders.
 *
 * Everything here is computed from the same list of days Meta answered with.
 * The ratios are recomputed from window totals rather than summed: a
 * cost-per-delivered figure is only meaningful as Σspent ÷ Σdelivered, and
 * adding thirty daily ratios would answer a different question.
 */
export interface TemplateCostFacts {
  /** Null when Meta withheld the money — never zero, which would read as free. */
  amountSpent: number | null;
  perDelivered: number | null;
  perUrlClick: number | null;
}

export interface TemplatePerformanceFacts {
  /**
   * Null when Meta could not be asked at all. Zero is a measurement; null is
   * the absence of one, and the screen draws them differently.
   */
  sent: number | null;
  delivered: number | null;
  read: number | null;
  /** Taps on a URL button. Only MARKETING and UTILITY templates report it. */
  clicked: number | null;
  /**
   * Distinct conversations that answered after this template was sent. Counted
   * here because Meta publishes no replies metric at all.
   */
  uniqueReplies: number;
}

export interface TemplateDayPoint {
  /** `YYYY-MM-DD`, UTC — the bucket Meta grouped by. */
  date: string;
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  spent: number | null;
}

export interface TemplateAnalyticsPayload {
  templateId: string;
  templateName: string;
  /** False until the customer turns Meta's one-way switch on for this WABA. */
  insightsEnabled: boolean;
  window: { days: number; start: string; end: string };
  currency: string | null;
  cost: TemplateCostFacts;
  performance: TemplatePerformanceFacts;
  series: TemplateDayPoint[];
  /**
   * Which sections Meta would not answer for. The rest of the payload is still
   * real, so a partial read renders as a partial screen rather than an error.
   */
  unavailable: string[];
  warning?: string;
}

const DAY_MS = 86_400_000;

/** A day bucket as Meta names it: the UTC date of the bucket's first second. */
export function dayKeyOf(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/**
 * One entry per day in the window, including days with no traffic.
 *
 * Meta omits empty days. Drawing only the days it sent would compress a quiet
 * fortnight into nothing and make the line lie about the shape of the month.
 */
export function buildSeries(
  points: TemplateAnalyticsPoint[],
  start: number,
  end: number,
): TemplateDayPoint[] {
  const buckets = new Map<string, TemplateDayPoint>();

  for (const point of points) {
    if (point.start === null) continue;

    const date = dayKeyOf(point.start);
    const bucket = buckets.get(date) ?? {
      date,
      sent: 0,
      delivered: 0,
      read: 0,
      clicked: 0,
      spent: null,
    };

    bucket.sent += point.sent ?? 0;
    bucket.delivered += point.delivered ?? 0;
    bucket.read += point.read ?? 0;
    bucket.clicked += point.clicked ?? 0;

    if (point.amountSpent !== null) {
      bucket.spent = (bucket.spent ?? 0) + point.amountSpent;
    }

    buckets.set(date, bucket);
  }

  const series: TemplateDayPoint[] = [];
  const from = Date.parse(`${dayKeyOf(start)}T00:00:00.000Z`);
  const to = Date.parse(`${dayKeyOf(end)}T00:00:00.000Z`);

  // A window is capped at ninety days upstream; the bound here only protects
  // against a clock or parameter surprise turning this into a runaway loop.
  for (let at = from, day = 0; at <= to && day < 120; at += DAY_MS, day += 1) {
    const date = new Date(at).toISOString().slice(0, 10);

    series.push(
      buckets.get(date) ?? {
        date,
        sent: 0,
        delivered: 0,
        read: 0,
        clicked: 0,
        spent: null,
      },
    );
  }

  return series;
}

/** Window totals, with spend kept null when Meta never named one. */
export function totalsOf(series: TemplateDayPoint[]): {
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  spent: number | null;
} {
  let spent: number | null = null;

  for (const day of series) {
    if (day.spent !== null) spent = (spent ?? 0) + day.spent;
  }

  return {
    sent: series.reduce((total, day) => total + day.sent, 0),
    delivered: series.reduce((total, day) => total + day.delivered, 0),
    read: series.reduce((total, day) => total + day.read, 0),
    clicked: series.reduce((total, day) => total + day.clicked, 0),
    spent,
  };
}

/**
 * The three money tiles.
 *
 * A ratio with no denominator is null rather than zero: "no deliveries, so no
 * cost per delivery" and "zero per delivery" are different sentences, and only
 * one of them is true.
 */
export function costFacts(
  totals: ReturnType<typeof totalsOf>,
): TemplateCostFacts {
  const ratio = (count: number): number | null => {
    if (totals.spent === null || count <= 0) return null;

    return Math.round((totals.spent / count) * 1e6) / 1e6;
  };

  return {
    amountSpent: totals.spent,
    perDelivered: ratio(totals.delivered),
    perUrlClick: ratio(totals.clicked),
  };
}
