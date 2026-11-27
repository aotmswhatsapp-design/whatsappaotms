"use client";

import * as React from "react";
import { History, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import {
  ApiError,
  startHistorySync,
  type CoexistenceSync,
} from "./api";

/**
 * The 24-hour obligation, said plainly.
 *
 * Three things make this card different from the rest of the panel: the sync
 * can be asked for only once per kind, only inside 24 hours of connecting, and
 * Meta's acceptance is not the same as its delivery. So the copy names the
 * phase the stamps describe, and the button exists only while asking again
 * could still work.
 */

export type SyncState = "idle" | "failed" | "sending" | "done" | "declined";

/** The stamps decide the state; no sentence is parsed back into a state. */
export function syncState(sync: CoexistenceSync): SyncState {
  if (sync.doneAt && sync.error) return "declined";
  if (sync.doneAt) return "done";
  if (sync.requestedAt) return "sending";
  if (sync.error) return "failed";
  return "idle";
}

export function CoexistenceCard({ sync }: { sync: CoexistenceSync }) {
  const toast = useToast();
  const [current, setCurrent] = React.useState(sync);
  const [pending, setPending] = React.useState(false);

  const state = syncState(current);

  async function retry() {
    setPending(true);

    try {
      const result = await startHistorySync();
      setCurrent(result.sync);

      toast.push({
        tone: result.sync.error ? "info" : "success",
        title: result.sync.error ? "Meta did not accept it" : "Asked Meta again",
        description:
          result.sync.error ??
          "The history arrives in phases; keep the WhatsApp Business app open.",
      });
    } catch (error) {
      toast.push({
        tone: "error",
        title: "Could not ask Meta",
        description:
          error instanceof ApiError ? error.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background px-3 py-3">
      <div className="flex items-start gap-2.5">
        <History
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold text-foreground">
            History from the WhatsApp Business app
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {state === "idle"
              ? "Meta has not been asked for this number's history yet."
              : state === "failed"
                ? `Meta refused the sync request: ${current.error}`
                : state === "sending"
                  ? "Meta accepted the request and is sending the history. It arrives in phases covering 180 days; keep the WhatsApp Business app open until it finishes."
                  : state === "done"
                    ? "History synchronised."
                    : "The business turned history sharing off in the WhatsApp Business app. Nothing was imported."}
          </p>

          {current.retryAllowed && (state === "idle" || state === "failed") ? (
            <Button
              className="mt-3"
              disabled={pending}
              onClick={retry}
              size="sm"
              variant={state === "failed" ? "outline" : "default"}
            >
              {pending ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <History aria-hidden="true" />
              )}
              {state === "failed" ? "Try again" : "Start sync"}
            </Button>
          ) : null}

          {state === "failed" && !current.retryAllowed ? (
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Meta only accepts this within 24 hours of connecting. Disconnect
              and connect again from the WhatsApp Business app to start it over.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}