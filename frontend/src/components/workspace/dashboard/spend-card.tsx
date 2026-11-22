import type { AnalyticsPricing } from "@/features/analytics/api";
import { formatMoney } from "@/lib/money";

import { ChartCard } from "./charts";

/**
 * What the window cost, per pricing category.
 *
 * Meta prices a message by the category it was sent under, so this is the
 * spend breakdown as Meta itself bills it. A dash is not zero: when Meta
 * reports volume without a figure — Solution-Partner billing does — the row
 * says the volume and leaves the money blank rather than inventing a number.
 */
export function SpendCard({
  rows,
  currency,
}: {
  rows: AnalyticsPricing[] | null;
  currency: string | null;
}) {
  const priced = rows?.some((row) => row.cost !== null) ?? false;
  const total = priced
    ? (rows ?? []).reduce((sum, row) => sum + (row.cost ?? 0), 0)
    : null;

  return (
    <ChartCard
      title="Spend by category"
      meta={
        <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
          {total === null ? "Volume only" : money(total, currency)}
        </span>
      }
      className="gap-2"
    >
      {rows === null ? (
        <p className="my-auto text-[12px] leading-relaxed text-muted-foreground">
          Meta did not answer the pricing read just now. The rest of this screen
          is unaffected; refresh to try again.
        </p>
      ) : rows.length === 0 ? (
        <p className="my-auto text-[12px] leading-relaxed text-muted-foreground">
          No priced messages in this window yet.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                <th className="pb-1.5 text-left font-semibold">Category</th>
                <th className="pb-1.5 text-right font-semibold">Messages</th>
                <th className="pb-1.5 text-right font-semibold">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.category} className="border-t border-border/70">
                  <td className="py-1.5 font-medium text-foreground">
                    {categoryLabel(row.category)}
                  </td>
                  <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                    {row.volume.toLocaleString("en-US")}
                  </td>
                  <td className="py-1.5 text-right text-foreground tabular-nums">
                    {row.cost === null ? (
                      <span
                        className="text-muted-foreground"
                        title="Meta reported volume without a cost for this category."
                      >
                        —
                      </span>
                    ) : (
                      money(row.cost, currency)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}

/**
 * Currency codes arrive from Meta; an unknown one renders the digits alone
 * rather than a guessed symbol. See `lib/money.ts` for why that matters.
 */
export function money(value: number, currency: string | null): string {
  return formatMoney(value, currency);
}

function categoryLabel(category: string): string {
  const words = category.toLowerCase().replace(/_/g, " ");

  return words.charAt(0).toUpperCase() + words.slice(1);
}
