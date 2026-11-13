import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const ACCENTS = {
  brand: "bg-brand-soft text-brand",
  blue: "bg-blue-soft text-blue",
  lime: "bg-lime-soft text-lime",
  muted: "bg-secondary text-muted-foreground",
} as const;

/**
 * Metric tile. `value` is rendered verbatim so a module with no data can pass
 * an em dash instead of pretending a zero is a real reading.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = "brand",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  accent?: keyof typeof ACCENTS;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
          {label}
        </p>
        <span
          className={cn("grid size-8 shrink-0 place-items-center rounded-lg", ACCENTS[accent])}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
