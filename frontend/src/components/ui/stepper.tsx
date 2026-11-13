"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export interface StepperStep {
  id: string;
  label: string;
}

export type StepState = "done" | "active" | "upcoming";

/**
 * Three-to-five stage progress rail and nothing more: it reports where the
 * flow is, it does not gate the form. Clicking a stage you have already
 * passed returns to it; a stage you have not reached is inert.
 */
export function Stepper({
  steps,
  current,
  onStepClick,
  className,
}: {
  steps: StepperStep[];
  current: number;
  onStepClick?: (index: number) => void;
  className?: string;
}) {
  return (
    <ol className={cn("flex items-center gap-1.5", className)}>
      {steps.map((step, index) => {
        const state: StepState =
          index < current ? "done" : index === current ? "active" : "upcoming";
        const clickable = Boolean(onStepClick) && index <= current;

        const content = (
          <>
            <span
              aria-hidden="true"
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold transition-colors",
                state === "active" && "border-brand bg-brand text-white shadow-sm shadow-brand/30",
                state === "done" && "border-lime/40 bg-lime-soft text-lime",
                state === "upcoming" && "border-border bg-card text-muted-foreground",
              )}
            >
              {state === "done" ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span
              className={cn(
                "truncate text-[11px] font-medium sm:text-xs",
                state === "upcoming" ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {step.label}
            </span>
          </>
        );

        const shared = "flex min-w-0 items-center gap-2 rounded-md text-left outline-none";
        const label = `Step ${index + 1} of ${steps.length}: ${step.label}`;

        return (
          <li
            key={step.id}
            className={cn("flex min-w-0 items-center gap-1.5", index < steps.length - 1 && "flex-1")}
          >
            {/* Without a handler a stage is a label, not a dead button. */}
            {clickable ? (
              <button
                aria-current={state === "active" ? "step" : undefined}
                aria-label={label}
                className={cn(shared, "cursor-pointer focus-visible:ring-ring/40 focus-visible:ring-[3px]")}
                onClick={() => onStepClick?.(index)}
                type="button"
              >
                {content}
              </button>
            ) : (
              <span
                aria-current={state === "active" ? "step" : undefined}
                aria-label={label}
                className={shared}
              >
                {content}
              </span>
            )}

            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "h-px min-w-3 flex-1 rounded-full",
                  index < current ? "bg-lime/50" : "bg-border",
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
