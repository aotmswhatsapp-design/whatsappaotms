"use client";

import * as React from "react";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  ApiError,
  INTEREST_LABELS,
  INTEREST_VALUES,
  setInterest,
  type LeadInterest,
} from "../api";

/**
 * The stage of the conversation on screen, and the one place a person can
 * correct it.
 *
 * The classifier's reason is shown beside the stage: a verdict nobody typed is
 * only trustworthy when the evidence is visible. A manual change says so in
 * the reason, so the next reader can tell the machine's opinion from a
 * colleague's.
 */
export function InterestChip({
  conversationId,
  interest,
  interestReason,
  canOverride,
  onChanged,
}: {
  conversationId: string;
  interest: LeadInterest;
  interestReason: string | null;
  /** A manager and above. An agent sees the stage and changes nothing. */
  canOverride: boolean;
  /** The write landed; the thread re-reads the row rather than patching. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  async function override(next: LeadInterest) {
    if (next === interest) return;

    setBusy(true);

    try {
      await setInterest(conversationId, next);

      // The server stamps the stage, the manual reason and the time. The
      // thread re-reads those instead of writing a guess made at click time,
      // which could be older than a change that landed meanwhile.
      onChanged();
    } catch (caught) {
      toast.push({
        tone: "error",
        title: "Could not change the stage",
        description:
          caught instanceof ApiError ? caught.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setBusy(false);
    }
  }

  const tone =
    interest === "INTERESTED"
      ? "bg-brand-soft text-brand"
      : interest === "NOT_INTERESTED"
        ? "bg-destructive/10 text-destructive"
        : "bg-secondary text-muted-foreground";

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-secondary/40 px-3 py-1.5 text-[11px] sm:px-4">
      <span className="font-medium text-muted-foreground">Stage</span>

      {canOverride ? (
        <select
          aria-label="Stage of this conversation"
          className={cn(
            "h-6 rounded-full px-2 text-[11px] font-semibold outline-none",
            "focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60",
            tone,
          )}
          disabled={busy}
          onChange={(event) => void override(event.target.value as LeadInterest)}
          value={interest}
        >
          {INTEREST_VALUES.map((value) => (
            <option key={value} value={value}>
              {INTEREST_LABELS[value]}
            </option>
          ))}
        </select>
      ) : (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
            tone,
          )}
        >
          {INTEREST_LABELS[interest]}
        </span>
      )}

      {interestReason ? (
        <span
          className="min-w-0 flex-1 truncate text-muted-foreground"
          title={interestReason}
        >
          {interestReason === "manual" ? "set by hand" : interestReason}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          No signal yet
        </span>
      )}
    </div>
  );
}
