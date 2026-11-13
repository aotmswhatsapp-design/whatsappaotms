import { CircleCheck, CircleMinus, CircleX } from "lucide-react";

import { cn } from "@/lib/utils";

import type { CheckResult, CheckState } from "./api";

const STATES: Record<
  CheckState,
  { icon: typeof CircleCheck; iconClass: string; rowClass: string }
> = {
  ok: {
    icon: CircleCheck,
    iconClass: "text-lime",
    rowClass: "border-lime/25 bg-lime-soft/40",
  },
  failed: {
    icon: CircleX,
    iconClass: "text-destructive",
    rowClass: "border-destructive/25 bg-destructive/5",
  },
  skipped: {
    icon: CircleMinus,
    iconClass: "text-muted-foreground",
    rowClass: "border-border/70 bg-secondary/50",
  },
};

/**
 * The persisted form of the toast: the same five verdicts, readable after the
 * toast has gone. Each row keeps Meta's own wording, because that is what the
 * user has to act on.
 */
export function CheckList({ checks }: { checks: CheckResult[] }) {
  return (
    <ul className="space-y-1.5">
      {checks.map((check) => {
        const state = STATES[check.state];
        const Icon = state.icon;

        return (
          <li
            key={check.key}
            className={cn(
              "flex items-start gap-2.5 rounded-lg border px-2.5 py-2",
              state.rowClass,
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn("mt-0.5 size-4 shrink-0", state.iconClass)}
            />
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-foreground">
                {check.label}
                <span className="ml-1.5 text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                  {check.state}
                </span>
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                {check.detail}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
