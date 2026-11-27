"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { useModule } from "@/components/workspace/access-provider";
import { cn } from "@/lib/utils";

import { fetchTasks, type FollowUpTask } from "../api";
import { shortDate } from "../format";

const SHOWN = 5;

/**
 * The viewer's open follow-ups, on the screen every role lands on.
 *
 * An agent cannot open the Leads page — the module is a manager's — but every
 * agent can be handed a follow-up, so the one place they all land has to show
 * them. The card is silent for a role without the inbox, because there is
 * nothing behind it to read.
 */
export function FollowUpsCard() {
  const inbox = useModule("inbox");
  const [tasks, setTasks] = React.useState<FollowUpTask[] | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!inbox) return;

    let active = true;

    fetchTasks("mine")
      .then((payload) => {
        if (!active) return;
        setTasks(payload.tasks);
        setFailed(false);
      })
      .catch(() => {
        // A card that cannot read must not claim there is nothing owed: it
        // disappears, and the Leads screen is where the error is explained.
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [inbox]);

  if (!inbox || failed) return null;

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-foreground">
          Your follow-ups
        </h2>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {tasks === null ? "reading…" : `${tasks.length} open`}
        </span>
      </header>

      {tasks === null ? (
        <div aria-hidden="true" className="space-y-2 p-4">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">
          Nothing owed. An interested lead opens one automatically.
        </p>
      ) : (
        <ul>
          {tasks.slice(0, SHOWN).map((task) => (
            <li key={task.id} className="border-b border-border last:border-0">
              <Link
                className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-secondary/50"
                href={`/workspace/inbox?conversation=${encodeURIComponent(task.conversationId)}`}
              >
                <CalendarClock
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 shrink-0",
                    task.overdue ? "text-destructive" : "text-muted-foreground",
                  )}
                />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-foreground">
                    {task.title}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {task.contact
                      ? task.contact.name ?? `+${task.contact.waId}`
                      : "The contact is gone"}
                  </span>
                </span>

                <span
                  className={cn(
                    "shrink-0 text-[10.5px] tabular-nums",
                    task.overdue
                      ? "font-medium text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {shortDate(task.dueAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
