"use client";

import Link from "next/link";
import { ArrowRight, Bell, Check } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOnboardingProgress } from "@/hooks/use-onboarding-progress";
import { cn } from "@/lib/utils";

/**
 * Notification feed. Until the backend emits real events, the feed is the
 * account's own setup checklist — the same three steps the overview shows,
 * with the same live state, so the badge count is truthful rather than
 * decorative. When every step is done the badge goes away instead of sitting
 * at zero.
 */
export function NotificationsMenu() {
  const { steps, remaining, total } = useOnboardingProgress();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={
            remaining > 0
              ? `Notifications, ${remaining} setup ${remaining === 1 ? "step" : "steps"} remaining`
              : "Notifications, setup complete"
          }
          className="relative inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <Bell className="size-5" aria-hidden="true" />
          {remaining > 0 ? (
            <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-brand text-[10px] leading-none font-semibold text-brand-foreground">
              {remaining}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[19rem] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold text-foreground">Getting started</p>
          <span className="text-[11px] font-medium text-muted-foreground">
            {remaining > 0 ? `${remaining} of ${total} left` : "All done"}
          </span>
        </div>

        <ul className="p-1.5">
          {steps.map((step) => (
            <li key={step.title}>
              <Link
                href={step.href}
                className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md",
                    step.done
                      ? "bg-lime/15 text-lime"
                      : "bg-brand-soft text-brand",
                  )}
                >
                  {step.done ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : (
                    <step.icon className="size-3.5" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {step.title}
                  </span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    {step.done ? "Done" : step.description}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="border-t border-border p-1.5">
          <Link
            href="/workspace"
            className="flex items-center justify-between rounded-lg px-2 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            Open the setup checklist
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
