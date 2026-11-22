"use client";

import { cn } from "@/lib/utils";

import type { CampaignStatus } from "../api";

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  RUNNING: "Running",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};

const STATUS_STYLE: Record<CampaignStatus, string> = {
  DRAFT: "border-border bg-secondary text-foreground",
  SCHEDULED: "border-brand/40 bg-brand-soft text-foreground",
  RUNNING: "border-whatsapp/40 bg-whatsapp/10 text-foreground",
  PAUSED: "border-warning/45 bg-warning/10 text-foreground",
  COMPLETED: "border-border bg-secondary text-muted-foreground",
  CANCELLED: "border-border bg-secondary text-muted-foreground",
  FAILED: "border-destructive/40 bg-destructive/5 text-foreground",
};

/** The word is the state; the border only makes it quicker to find. */
export function StatusPill({ status }: { status: CampaignStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[11.5px] font-medium",
        STATUS_STYLE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
