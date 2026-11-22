"use client";

import { formatMoney } from "@/lib/money";

import type { AnalyticsMonthStat } from "../api";

/**
 * Monthly spend.
 *
 * Bars are hand-rolled rather than pulled from a chart library: the figure here
 * is a single monthly amount, and the only thing a chart has to add is the
 * shape of the trend. When Meta returned no cost for any month the chart counts
 * delivered messages instead and says so in the caption — a flat row of zeroes
 * would claim every month was free.
 */
export function SpendChart({
  months,
  currency,
}: {
  months: AnalyticsMonthStat[];
  currency: string | null;
}) {
  if (months.length === 0) {
    return (
      <div className="grid h-40 place-items-center rounded-lg border border-dashed border-border bg-secondary/40">
        <p className="px-4 text-center text-[12.5px] text-muted-foreground">
          No snapshot covers these dates yet.
        </p>
      </div>
    );
  }

  const priced = months.some((month) => month.spent !== null);
  const values = months.map((month) =>
    priced ? (month.spent ?? 0) : month.delivered,
  );
  const max = Math.max(...values, 0);
  const total = priced
    ? months.reduce((sum, month) => sum + (month.spent ?? 0), 0)
    : months.reduce((sum, month) => sum + month.delivered, 0);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">
          {priced ? "Actual charges, by month" : "Delivered messages, by month"}
        </p>
        <p className="text-sm font-semibold text-foreground tabular-nums">
          {priced ? formatMoney(total, currency) : `${total.toLocaleString()} delivered`}
        </p>
      </div>

      <div
        aria-label={
          priced
            ? `Monthly spend across ${months.length} months`
            : `Monthly delivered messages across ${months.length} months`
        }
        className="mt-4 flex h-40 items-end gap-2 sm:gap-3"
        role="img"
      >
        {months.map((month) => {
          const value = priced ? (month.spent ?? 0) : month.delivered;
          // A hairline for a month that has a value but rounds to nothing, so
          // "a little" never looks identical to "none".
          const height = max === 0 ? 0 : Math.max((value / max) * 100, value > 0 ? 3 : 0);

          return (
            <div
              className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5"
              key={month.month}
              title={`${monthLabel(month.month)}: ${
                priced
                  ? formatMoney(month.spent, currency)
                  : `${month.delivered.toLocaleString()} delivered`
              }`}
            >
              <div
                className="w-full rounded-t bg-brand/75 transition-colors hover:bg-brand"
                style={{ height: `${height}%` }}
              />
              <span className="truncate text-center text-[10px] font-medium text-muted-foreground">
                {monthLabel(month.month)}
              </span>
            </div>
          );
        })}
      </div>

      {priced ? null : (
        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
          Meta returned no charge for these months, so the bars count delivered
          messages instead. They are not an estimate of what this cost.
        </p>
      )}
    </div>
  );
}

function monthLabel(month: string): string {
  const at = new Date(`${month}-01T00:00:00.000Z`);

  if (Number.isNaN(at.getTime())) return month;

  return at.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}
