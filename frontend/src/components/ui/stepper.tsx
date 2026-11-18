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
    // On a phone the rail stacks each stage over its label: squeezing circle and
    // label into one line truncated every stage to three letters as soon as the
    // type got readable. Connectors return above `sm`, where there is room.
    <ol
      className={cn(
        "flex items-start justify-between gap-1.5 sm:items-center sm:justify-normal",
        className,
      )}
    >
      {steps.map((step, index) => {
        const state: StepState =
          index < current ? "done" : index === current ? "active" : "upcoming";
        const clickable = Boolean(onStepClick) && index <= current;

        const content = (
          <>
            <span
              aria-hidden="true"
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-full border text-[12px] font-semibold transition-colors",
                state === "active" && "border-brand bg-brand text-brand-foreground shadow-sm shadow-brand/30",
                state === "done" && "border-lime/40 bg-lime-soft text-lime",
                state === "upcoming" && "border-border bg-card text-muted-foreground",
              )}
            >
              {state === "done" ? <Check className="size-4" /> : index + 1}
            </span>
            <span
              className={cn(
                "text-center text-xs leading-tight font-medium sm:truncate sm:text-left sm:text-[13px]",
                state === "upcoming" ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {step.label}
            </span>
          </>
        );

        const shared = "flex min-w-0 flex-col items-center gap-1 rounded-md text-left outline-none sm:flex-row sm:gap-2";
        const label = `Step ${index + 1} of ${steps.length}: ${step.label}`;

        return (
          <li
            key={step.id}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center gap-1 sm:flex-row sm:items-center sm:gap-1.5",
              index === steps.length - 1 && "sm:flex-none",
            )}
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
                  "hidden h-px min-w-3 flex-1 rounded-full sm:block",
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
