"use client";

import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  PlugZap,
  ShieldCheck,
} from "lucide-react";

import { useOnboardingProgress } from "@/hooks/use-onboarding-progress";
import { useWhatsAppStatus } from "@/hooks/use-whatsapp-status";
import { cn } from "@/lib/utils";

/**
 * Dashboard widgets that are chrome rather than charts: the setup checklist
 * and the WhatsApp connection state. Both are honest — nothing here is sample
 * data, so neither carries the preview label, and both read the same
 * `/v1/whatsapp/status` answer as the sidebar dot.
 */

export function SetupWidget() {
  const { steps, done, total } = useOnboardingProgress();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 p-4 pb-3">
        <div>
          <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
            Finish setting up
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {done === total
              ? "Every step is behind you."
              : "Three steps between this account and its first send."}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {done} / {total}
        </span>
      </div>

      <ol className="min-h-0 flex-1 overflow-y-auto">
        {steps.map((step, index) => (
          <li key={step.title}>
            <Link
              href={step.href}
              className="group flex items-center gap-3 border-t border-border px-4 py-3 transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60 focus-visible:outline-none"
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
                  step.done
                    ? "border-lime/40 bg-lime/15 text-lime"
                    : "border-border text-muted-foreground",
                )}
              >
                {step.done ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <step.icon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-foreground">
                  {step.title}
                  {step.done ? (
                    <span className="ml-1.5 text-[11px] font-normal text-lime">
                      Done
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                  {step.description}
                </span>
              </span>
              <ArrowRight
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ol>

      <p className="flex shrink-0 items-start gap-2 border-t border-border px-4 py-3 text-[11px] leading-snug text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        {done > 0
          ? "The charts read live from Meta; a reading Meta refuses stays blank rather than becoming a zero."
          : "Connect a number and every chart reads live from your Meta account."}
      </p>
    </div>
  );
}

export function ConnectionWidget() {
  const status = useWhatsAppStatus();
  const number = status.number;
  const live = status.state === "live";

  const rows = [
    [
      "Business account",
      number?.businessName ?? number?.businessAccountId ?? "Not linked",
    ],
    [
      "Phone number",
      number?.display ?? (number ? `id ${number.phoneNumberId}` : "None registered"),
    ],
    [
      "Webhook",
      live
        ? "Receiving events"
        : number?.receiving
          ? "Awaiting the first delivery"
          : "Not configured",
    ],
    ["Verified name", number?.verifiedName ?? "—"],
    ["Quality rating", number?.quality ?? "—"],
  ] as const;

  const badge = live
    ? { dot: "bg-lime", label: "Live" }
    : status.state === "pending"
      ? { dot: "bg-warning", label: "Waiting for Meta" }
      : status.state === "error"
        ? { dot: "bg-destructive", label: "Needs attention" }
        : { dot: "bg-muted-foreground", label: "Not connected" };

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
          WhatsApp connection
        </h2>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", badge.dot)} aria-hidden="true" />
          {badge.label}
        </span>
      </div>

      <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
        {status.state === "error"
          ? (status.reason ??
            "Meta no longer accepts the stored credentials. Open the settings to fix them.")
          : live
            ? "Meta delivers events here directly, so campaigns, the inbox and the chatbot are live."
            : number
              ? "Saved and verified. Meta has not confirmed the webhook yet, so nothing is delivered."
              : "Campaigns, the inbox and chatbot replies all need a verified Business number."}
      </p>

      <dl className="mt-2 space-y-1 text-[11px]">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 border-b border-border/70 pb-1 last:border-0 last:pb-0"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      <Link
        href="/workspace/whatsapp"
        className="mt-auto inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <PlugZap className="size-3.5" aria-hidden="true" />
        {number ? "Manage the connection" : "Start the connection"}
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}
