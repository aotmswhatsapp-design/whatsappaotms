"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";

import {
  INTEREST_LABELS,
  INTEREST_VALUES,
  type LeadInterest,
  type PipelineView,
} from "../api";
import { shortDate } from "../format";

const SELECT =
  "h-7 max-w-[9.5rem] rounded-md border border-input bg-background px-1.5 text-[11px] font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The pipeline as four columns, not a table: a stage is a place a conversation
 * sits in, and a lead that moves should be seen to move. The card's body is a
 * link into the thread — the board is a map, and the work happens in the inbox
 * — except that a manager may open a follow-up here for a lead intake left
 * alone.
 */
export function PipelineBoard({
  columns,
  canOverride,
  busyId,
  onOverride,
  onCreateTask,
}: {
  columns: PipelineView["columns"];
  canOverride: boolean;
  busyId: string | null;
  onOverride: (conversationId: string, interest: LeadInterest) => void;
  onCreateTask: (conversationId: string) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((column) => (
        <section
          key={column.key}
          aria-label={`${column.label} — ${column.rows.length}`}
          className="flex w-[17rem] shrink-0 flex-col rounded-xl border border-border bg-secondary/40"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h2 className="text-[12px] font-semibold text-foreground">
              {column.label}
            </h2>
            <span className="rounded-full bg-card px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground tabular-nums">
              {column.rows.length}
            </span>
          </header>

          <ul className="flex flex-col gap-2 p-2">
            {column.rows.length === 0 ? (
              <li className="px-1 py-6 text-center text-[11.5px] text-muted-foreground">
                Nothing here.
              </li>
            ) : null}

            {column.rows.map((lead) => {
              const name = lead.contact.name ?? `+${lead.contact.waId}`;

              return (
                <li
                  key={lead.id}
                  className="rounded-lg border border-border bg-card p-2.5"
                >
                  <Link
                    className="block min-w-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                    href={`/workspace/inbox?conversation=${encodeURIComponent(lead.id)}`}
                  >
                    <p className="flex items-baseline gap-1.5">
                      <span className="truncate text-[12.5px] font-medium text-foreground">
                        {name}
                      </span>
                      {lead.unreadCount > 0 ? (
                        <span className="ml-auto grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-foreground tabular-nums">
                          {lead.unreadCount > 99 ? "99+" : lead.unreadCount}
                        </span>
                      ) : null}
                    </p>

                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
                      {lead.lastMessagePreview ?? "No messages yet"}
                    </p>

                    <p className="mt-1 text-[10.5px] text-muted-foreground tabular-nums">
                      {shortDate(lead.lastMessageAt)}
                      {lead.assignedTo
                        ? ` · ${lead.assignedTo.name ?? "assigned"}`
                        : " · unassigned"}
                    </p>
                  </Link>

                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-1.5">
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted-foreground">
                      {lead.interestReason ?? "No reason recorded"}
                    </span>

                    {canOverride ? (
                      <select
                        aria-label={`Stage for ${name}`}
                        className={SELECT}
                        disabled={busyId === lead.id}
                        onChange={(event) =>
                          onOverride(lead.id, event.target.value as LeadInterest)
                        }
                        value={lead.interest}
                      >
                        {INTEREST_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {INTEREST_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>

                  {lead.openTask ? (
                    <p className="mt-1.5 flex items-center gap-1 text-[10.5px] font-medium text-warning">
                      <CalendarClock aria-hidden="true" className="size-3" />
                      <span className="truncate">{lead.openTask.title}</span>
                      <span className="shrink-0 tabular-nums">
                        {shortDate(lead.openTask.dueAt)}
                      </span>
                    </p>
                  ) : canOverride ? (
                    <button
                      aria-label={`Create a follow-up for ${name}`}
                      className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-medium text-brand outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busyId === lead.id}
                      onClick={() => onCreateTask(lead.id)}
                      type="button"
                    >
                      <CalendarClock aria-hidden="true" className="size-3" />
                      Follow up
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
