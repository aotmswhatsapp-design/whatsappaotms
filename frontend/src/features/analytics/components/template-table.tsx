"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";

import type { AnalyticsTemplateStat } from "../api";

/**
 * The template table.
 *
 * A row is a button rather than a link: the interesting detail — clicks, cost
 * per click, how many days carried traffic — does not fit in seven columns, and
 * a table that navigates away cannot show it without losing the filters. The
 * template's own screen is one link away inside the expansion.
 *
 * Every figure here is Meta's. A dash in a cost column means Meta returned no
 * cost, never that the messages were free, and the row says so on hover.
 */
export function TemplateTable({
  rows,
  currency,
}: {
  rows: AnalyticsTemplateStat[];
  currency: string | null;
}) {
  const [open, setOpen] = React.useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
            <th className="py-2 pr-3 text-left font-semibold">Template</th>
            <th className="px-3 py-2 text-left font-semibold">Category</th>
            <th className="px-3 py-2 text-right font-semibold">Sent</th>
            <th className="px-3 py-2 text-right font-semibold">Delivered</th>
            <th className="px-3 py-2 text-right font-semibold">Read</th>
            <th className="px-3 py-2 text-right font-semibold">Total spend</th>
            <th className="py-2 pl-3 text-right font-semibold">
              Cost / delivered
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = open === row.templateId;

            return (
              <React.Fragment key={row.templateId}>
                <tr
                  className={cn(
                    "border-b border-border/70 transition-colors",
                    expanded ? "bg-secondary/50" : "hover:bg-secondary/35",
                  )}
                >
                  <td className="py-2.5 pr-3">
                    <button
                      aria-expanded={expanded}
                      className="flex w-full items-center gap-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
                      onClick={() =>
                        setOpen(expanded ? null : row.templateId)
                      }
                      type="button"
                    >
                      <ChevronRight
                        aria-hidden="true"
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground transition-transform",
                          expanded && "rotate-90",
                        )}
                      />
                      <span className="truncate font-mono font-medium text-foreground">
                        {row.name}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {row.category ? categoryLabel(row.category) : "—"}
                  </td>
                  <Cell value={row.sent} />
                  <Cell value={row.delivered} />
                  <Cell value={row.read} />
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <Amount value={row.spent} currency={currency} />
                  </td>
                  <td className="py-2.5 pl-3 text-right tabular-nums">
                    <Amount value={row.costPerDelivered} currency={currency} />
                  </td>
                </tr>

                {expanded ? (
                  <tr className="border-b border-border/70 bg-secondary/30">
                    <td className="px-3 py-3" colSpan={7}>
                      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                        <Fact label="Unique URL clicks" value={row.clicked.toLocaleString()} />
                        <Fact
                          label="Cost per URL click"
                          value={<Amount value={row.costPerUrlClick} currency={currency} />}
                        />
                        <Fact
                          label="Days with activity"
                          value={row.activeDays.toLocaleString()}
                        />
                        <Fact
                          label="Meta template id"
                          value={<span className="font-mono">{row.templateId}</span>}
                        />
                      </dl>

                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
                        <span>
                          Snapshotted {clockOf(row.lastSyncedAt)}
                          {row.costState === "UNAVAILABLE"
                            ? " · Meta returned no cost for these sends"
                            : " · cost as Meta reported it"}
                        </span>
                        {row.messageTemplateId ? (
                          <Link
                            className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4 hover:text-brand"
                            href={`/workspace/templates/${row.messageTemplateId}`}
                          >
                            Open the template
                            <ExternalLink aria-hidden="true" className="size-3" />
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ value }: { value: number }) {
  return (
    <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
      {value.toLocaleString()}
    </td>
  );
}

/**
 * An amount, or a dash.
 *
 * The dash carries its reason: a missing charge is the documented answer for
 * accounts billed through a partner's credit line, and a reader who sees `—`
 * beside a busy template deserves to know that before assuming a bug.
 */
function Amount({
  value,
  currency,
}: {
  value: number | null;
  currency: string | null;
}) {
  if (value === null) {
    return (
      <span
        className="text-muted-foreground"
        title="Meta returned no cost figure for these messages."
      >
        —
      </span>
    );
  }

  return <span className="text-foreground">{formatMoney(value, currency)}</span>;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

function categoryLabel(category: string): string {
  const words = category.toLowerCase().replace(/_/g, " ");

  return words.charAt(0).toUpperCase() + words.slice(1);
}

function clockOf(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
