import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

import type { TemplateFacts } from "../api";
import {
  categoryLabel,
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

/**
 * One template, as one row of the catalogue.
 *
 * The row carries what identifies the template — its name, review state and the
 * facts that place it — and nothing else. Its numbers live on its own page,
 * because a list of figures that Meta withholds half the time reads as a list
 * of dashes. The whole row is the link; there is no button inside it to swallow
 * a click.
 */
export function TemplateRow({
  row,
  href,
}: {
  row: TemplateFacts;
  /** Where the row leads: the template's own page. */
  href: string;
}) {
  const tone = statusTone(row.status);
  const quality = row.qualityScore
    ? QUALITY[row.qualityScore.toUpperCase()]
    : undefined;

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
