"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, Check, Loader2, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { ApiError, taskWhatsApp, updateTask, type FollowUpTask } from "../api";
import { shortDate } from "../format";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The follow-ups someone owes, soonest first. Three actions, because those are
 * the three things a person does with a reminder: send it, finish it, or push
 * it a day.
 */
export function TaskList({
  tasks,
  onChanged,
}: {
  tasks: FollowUpTask[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  function failed(title: string, caught: unknown) {
    toast.push({
      tone: "error",
      title,
      description:
        caught instanceof ApiError ? caught.message : "The request failed.",
      duration: 0,
    });
  }

  async function done(task: FollowUpTask) {
    setBusy(task.id);

    try {
      const { task: next } = await updateTask(task.id, { status: "DONE" });
      onChanged();
      toast.push({
        tone: "success",
        title: "Follow-up closed",
        description: next.title,
      });
    } catch (caught) {
      failed("Could not close the follow-up", caught);
    } finally {
      setBusy(null);
    }
  }

  async function tomorrow(task: FollowUpTask) {
    setBusy(task.id);

    try {
      const dueAt = new Date(Date.now() + DAY_MS).toISOString();
      const { task: next } = await updateTask(task.id, { dueAt });
      onChanged();
      toast.push({ tone: "success", title: "Pushed to tomorrow", description: next.title });
    } catch (caught) {
      failed("Could not move the deadline", caught);
    } finally {
      setBusy(null);
    }
  }

  async function send(task: FollowUpTask) {
    setBusy(task.id);

    try {
      const { url, text } = await taskWhatsApp(task.id);

      // The text names the business, the customer and the enquiry, so the
      // member is not writing a cold message. Copied as well as opened: a
      // browser that blocks the popup still leaves them something to paste.
      await navigator.clipboard.writeText(text).catch(() => undefined);
      window.open(url, "_blank", "noopener,noreferrer");

      toast.push({
        tone: "success",
        title: "Message copied",
        description: "Paste it into the chat and send.",
      });
    } catch (caught) {
      // 409 `NO_PERSONAL_NUMBER` lands here: the owner has not set this
      // member's number yet, and the message says which screen fixes it.
      failed("Could not open WhatsApp", caught);
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="space-y-2">
      {tasks.map((task) => (
        <li
          key={task.id}
          className={cn(
            "rounded-xl border bg-card p-3",
            task.overdue ? "border-destructive/40" : "border-border",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-foreground">{task.title}</p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {task.contact
                  ? task.contact.name ?? `+${task.contact.waId}`
                  : "The contact is gone"}
                {" · "}
                <Link
                  className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                  href={`/workspace/inbox?conversation=${encodeURIComponent(task.conversationId)}`}
                >
                  Open the chat
                </Link>
              </p>
            </div>

            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums",
                task.overdue
                  ? "bg-destructive/10 text-destructive"
                  : "bg-secondary text-muted-foreground",
              )}
            >
              {task.overdue ? "Overdue · " : "Due "}
              {shortDate(task.dueAt)}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              disabled={busy === task.id}
              onClick={() => void send(task)}
              size="sm"
              type="button"
              variant="outline"
            >
              <MessageCircle aria-hidden="true" />
              Send from my WhatsApp
            </Button>

            <Button
              disabled={busy === task.id}
              onClick={() => void done(task)}
              size="sm"
              type="button"
            >
              {busy === task.id ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Check aria-hidden="true" />
              )}
              Done
            </Button>

            <Button
              disabled={busy === task.id}
              onClick={() => void tomorrow(task)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <CalendarClock aria-hidden="true" />
              Tomorrow
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
