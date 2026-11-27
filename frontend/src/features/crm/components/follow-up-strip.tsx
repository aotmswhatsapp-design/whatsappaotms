"use client";

import * as React from "react";
import { CalendarClock, Check, Loader2, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAccess } from "@/components/workspace/access-provider";
import { cn } from "@/lib/utils";

import {
  ApiError,
  taskWhatsApp,
  updateTask,
  type FollowUpTaskRef,
} from "../api";
import { shortDate } from "../format";

/**
 * The open follow-up under the thread's header. Nothing renders when nothing
 * is owed: a strip that says "no task" on every ordinary conversation is a
 * band of height for a sentence nobody needs.
 */
export function FollowUpStrip({
  task,
  onChanged,
}: {
  task: FollowUpTaskRef | null;
  /** The write landed; the thread re-reads the row rather than patching. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const { hasPersonalWhatsApp } = useAccess();
  const [busy, setBusy] = React.useState(false);
  // The id this strip closed itself. A new task on the same thread carries a
  // new id and shows again; until the re-read lands, Done cannot be pressed
  // twice against a task the server already closed.
  const [closedId, setClosedId] = React.useState<string | null>(null);

  if (!task || task.id === closedId) return null;

  // Narrowed once, outside the handlers: a closure cannot rely on the guard
  // above, because TypeScript does not narrow a captured parameter.
  const open = task;
  const overdue = isOverdue(open.dueAt);
  const sendBlocked = hasPersonalWhatsApp === false;

  function failed(title: string, caught: unknown) {
    toast.push({
      tone: "error",
      title,
      description:
        caught instanceof ApiError ? caught.message : "The request failed.",
      duration: 0,
    });
  }

  async function done() {
    setBusy(true);

    try {
      await updateTask(open.id, { status: "DONE" });
      setClosedId(open.id);
      onChanged();
    } catch (caught) {
      failed("Could not close the follow-up", caught);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);

    try {
      const { url, text } = await taskWhatsApp(open.id);

      await navigator.clipboard.writeText(text).catch(() => undefined);
      window.open(url, "_blank", "noopener,noreferrer");

      toast.push({
        tone: "success",
        title: "Message copied",
        description: "Paste it into the chat and send.",
      });
    } catch (caught) {
      // 409 `NO_PERSONAL_NUMBER` lands here; the API's sentence says who sets it.
      failed("Could not open WhatsApp", caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 sm:px-4">
      <CalendarClock
        aria-hidden="true"
        className={cn(
          "size-3.5",
          overdue ? "text-destructive" : "text-muted-foreground",
        )}
      />

      <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">
        {open.title}
        <span
          className={cn(
            "ml-1.5 text-[10.5px] tabular-nums",
            overdue ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {overdue ? "overdue" : "due"} {shortDate(open.dueAt)}
        </span>
      </span>

      <Button
        disabled={busy || sendBlocked}
        onClick={() => void send()}
        size="sm"
        type="button"
        variant="outline"
      >
        <MessageCircle aria-hidden="true" />
        Send from my WhatsApp
      </Button>

      <Button
        disabled={busy}
        onClick={() => void done()}
        size="sm"
        type="button"
      >
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        Done
      </Button>

      {sendBlocked ? (
        <span className="basis-full text-[10.5px] leading-relaxed text-muted-foreground">
          Add your number under Team &amp; permissions to send from your own
          WhatsApp.
        </span>
      ) : null}
    </div>
  );
}

/**
 * Past its deadline. A module-level helper, like the rest of the CRM's date
 * work: the read happens once per render either way, and keeping the clock out
 * of the component body is what the compiler's purity rule asks for.
 */
function isOverdue(dueAt: string | null): boolean {
  return dueAt !== null && Date.parse(dueAt) < Date.now();
}
