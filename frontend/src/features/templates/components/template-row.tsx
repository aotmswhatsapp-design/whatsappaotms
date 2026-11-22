import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

import type { TemplateFacts, TemplatePerformanceRow } from "../api";
import {
  categoryLabel,
  countLabel,
  moneyLabel,
  STATUS_TONE_CLASS,
  STATUS_TONE_DOT,
  statusLabel,
  statusTone,
  updatedLabel,
} from "../format";
import { languageLabel } from "../languages";

const QUALITY: Record<string, { label: string; className: string }> = {
  GREEN: { label: "High quality", className: "bg-lime" },
  YELLOW: { label: "Medium quality", className: "bg-warning" },
  RED: { label: "Low quality", className: "bg-destructive" },
};

/** The two money columns, wide enough that figures line up down the list. */
const DELIVERED_WIDTH = "w-24";
const SPEND_WIDTH = "w-28";

/**
 * One template, as one row of the catalogue.
 *
 * Left is the template — its name, review state and the facts that identify it.
 * Right is what it did: how many messages Meta delivered and what Meta charged
 * for them. The whole row is the link, because a list row has nothing else to
 * offer once the figures are shown; there is no button inside it to swallow a
 * click.
 *
 * Absent figures are em dashes. `metrics` is undefined while the numbers are
 * still in flight, and its fields are null when Meta would not answer, so a
 * quiet template and an unmeasured one never look the same.
 */
export function TemplateRow({
  row,
  href,
  metrics,
  currency,
}: {
  row: TemplateFacts;
  /** Where the row leads: the template's own page. */
  href: string;
  metrics?: TemplatePerformanceRow;
  /** Meta's billing currency for the account; null when it never named one. */
  currency: string | null;
}) {
  const tone = statusTone(row.status);
  const quality = row.qualityScore
    ? QUALITY[row.qualityScore.toUpperCase()]
    : undefined;

  const delivered = countLabel(metrics?.delivered);
  const spend = moneyLabel(metrics?.spent, currency);

  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        className="group flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-secondary/45 focus-visible:bg-secondary/45 focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:ring-inset"
        href={href}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[13px] font-medium text-foreground">
              {row.name}
            </span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
                STATUS_TONE_CLASS[tone],
              )}
            >
              <span
                aria-hidden="true"
                className={cn("size-1.5 rounded-full", STATUS_TONE_DOT[tone])}
              />
              {statusLabel(row.status)}
            </span>
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
            <span>{categoryLabel(row.category)}</span>
            <Separator>
              <span>{languageLabel(row.language)}</span>
            </Separator>
            {quality ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 rounded-full", quality.className)}
                />
                {quality.label}
              </span>
            ) : null}
            <Separator>
              <span className="tabular-nums">
                Updated {updatedLabel(row.updatedAt)}
              </span>
            </Separator>
          </div>

          {row.rejectedReason ? (
            <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-snug text-destructive">
              <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              {row.rejectedReason}
            </p>
          ) : null}

          {/* Narrow screens: the same two figures, under the name, left-aligned. */}
          <div className="mt-2 flex gap-5 sm:hidden">
            <Figure label="Delivered" value={delivered} />
            <Figure label="Spend" value={spend} />
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-5 sm:flex">
          <Figure
            align="right"
            className={DELIVERED_WIDTH}
            label="Delivered"
            value={delivered}
          />
          <Figure align="right" className={SPEND_WIDTH} label="Spend" value={spend} />
        </div>

        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </li>
  );
}

/**
 * Column labels for the wide layout. Rendered once above the list so the two
 * figures do not need a caption on every row.
 */
export function TemplateRowHead() {
  return (
    <div className="hidden items-center gap-3 border-b border-border bg-secondary/40 px-4 py-2 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase sm:flex">
      <span className="flex-1">Template</span>
      <span className="flex shrink-0 items-center gap-5">
        <span className={cn(DELIVERED_WIDTH, "text-right")}>Delivered</span>
        <span className={cn(SPEND_WIDTH, "text-right")}>Spend</span>
      </span>
      <span aria-hidden="true" className="w-4 shrink-0" />
    </div>
  );
}

function Figure({
  label,
  value,
  align,
  className,
}: {
  label: string;
  value: string;
  align?: "right";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "shrink-0",
        align === "right" && "text-right",
        className,
      )}
    >
      <p className="text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-[13px] font-medium tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

/**
 * A middot bound to the item that follows it, so a wrapped line never ends on
 * a separator with nothing after it. The quality score needs no separator: its
 * coloured dot divides it from whatever precedes.
 */
function Separator({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="text-muted-foreground/50">
        ·
      </span>
      {children}
    </span>
  );
}
