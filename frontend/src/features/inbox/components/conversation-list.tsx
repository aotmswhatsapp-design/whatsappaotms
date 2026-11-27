"use client";

import * as React from "react";
import { Check, ChevronDown, ListFilter, Loader2, Search, X } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  INTEREST_LABELS,
  type LeadInterest,
} from "@/features/crm/api";
import { cn } from "@/lib/utils";

import {
  type Conversation,
  type ConversationFilters,
  type ConversationStatus,
} from "../api";
import { dayKey, dayLabel, displayPhone, initials, relativeTime } from "../format";

const STATUSES: { value: ConversationStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "OPEN", label: "Open" },
  { value: "PENDING", label: "Pending" },
  { value: "CLOSED", label: "Closed" },
];

const ASSIGNEES: { value: string; label: string }[] = [
  { value: "", label: "Anyone" },
  { value: "me", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned" },
];

/**
 * The stage menu. Every row but "Follow-up" is a stored interest; that row is
 * the derived pair of an interested lead and the task it still owes, so it
 * travels as its own query parameter rather than pretending to be a stage.
 */
const STAGES: {
  key: string;
  label: string;
  interest?: LeadInterest;
  followUp?: "open";
}[] = [
  { key: "", label: "Any stage" },
  { key: "UNKNOWN", label: INTEREST_LABELS.UNKNOWN, interest: "UNKNOWN" },
  { key: "INTERESTED", label: INTEREST_LABELS.INTERESTED, interest: "INTERESTED" },
  { key: "FOLLOW_UP", label: "Follow-up", followUp: "open" },
  {
    key: "NOT_INTERESTED",
    label: INTEREST_LABELS.NOT_INTERESTED,
    interest: "NOT_INTERESTED",
  },
];

/** Whether one stage row is the filter in force. */
function stageInForce(
  row: (typeof STAGES)[number],
  filters: ConversationFilters,
): boolean {
  if (row.key === "") return !filters.interest && !filters.followUp;

  return row.followUp
    ? filters.followUp === row.followUp
    : filters.interest === row.interest;
}

/**
 * The queue. Filters are owned by the parent so a refresh keeps them, and the
 * row is a button — not a div with a click handler — so keyboard navigation
 * works without extra ARIA.
 *
 * Both filters live behind one icon menu in the header, which is what keeps the
 * search box the only piece of chrome competing for width in the left pane.
 */
export function ConversationList({
  conversations,
  selectedId,
  loading,
  filters,
  search,
  onSearchChange,
  onFiltersChange,
  onSelect,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  loading: boolean;
  filters: ConversationFilters;
  search: string;
  unread: number;
  onSearchChange: (value: string) => void;
  onFiltersChange: (next: ConversationFilters) => void;
  onSelect: (id: string) => void;
}) {
  const statusLabel =
    STATUSES.find((row) => row.value === (filters.status ?? ""))?.label ?? "All statuses";
  const assigneeLabel =
    ASSIGNEES.find((row) => row.value === (filters.assignee ?? ""))?.label ?? "Anyone";
  const stageLabel =
    STAGES.find((row) => stageInForce(row, filters))?.label ?? "Any stage";

  // Clearing unmounts the button that had focus, so focus is handed back to
  // the field rather than dropped on the body.
  const field = React.useRef<HTMLInputElement>(null);

  // Only the filters that are doing something, so the pill says "Interested"
  // rather than "All statuses · Anyone · Interested".
  const active = [
    filters.status ? statusLabel : null,
    filters.assignee ? assigneeLabel : null,
    filters.interest || filters.followUp ? stageLabel : null,
  ].filter((value): value is string => Boolean(value));

  const filtered = active.length > 0;
  const summary = filtered ? active.join(" · ") : "All chats";

  // One label per calendar day, in the order the rows arrive (newest first).
  // A queue that is a day old reads as two stacks instead of an undated list.
  const groups = React.useMemo(() => {
    const buckets: { key: string; label: string; rows: Conversation[] }[] = [];

    for (const conversation of conversations) {
      const key = dayKey(conversation.lastMessageAt);
      const last = buckets[buckets.length - 1];

      if (last && last.key === key) {
        last.rows.push(conversation);
      } else {
        buckets.push({
          key,
          label: dayLabel(conversation.lastMessageAt),
          rows: [conversation],
        });
      }
    }

    return buckets;
  }, [conversations]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 pr-2 pl-3.5">
        <p className="text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">Chats</p>
        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
          {conversations.length}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Filter conversations — ${summary}`}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium outline-none transition-colors",
                  "hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  filtered ? "bg-brand-soft text-brand" : "text-muted-foreground",
                )}
              >
                <ListFilter aria-hidden="true" className="size-3.5" />
                <span className="hidden min-w-0 truncate sm:inline">{summary}</span>
                <ChevronDown aria-hidden="true" className="size-3.5 opacity-60" />
              </button>
            </DropdownMenuTrigger>

            {/* The menu is portalled to the body, so it leaves the card that
                carries the inbox palette. Passing the attribute here puts the
                menu back inside that scope. */}
            <DropdownMenuContent align="end" className="w-64" data-theme="inbox">
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              {STATUSES.map((row) => (
                <DropdownMenuItem
                  key={row.label}
                  onSelect={() =>
                    onFiltersChange({
                      ...filters,
                      status: row.value || undefined,
                    })
                  }
                >
                  {row.label}
                  {!filters.status && row.value === "" ? <Check className="ml-auto" /> : null}
                  {filters.status === row.value ? <Check className="ml-auto" /> : null}
                </DropdownMenuItem>
              ))}

              <DropdownMenuSeparator />
              <DropdownMenuLabel>Assigned to</DropdownMenuLabel>
              {ASSIGNEES.map((row) => (
                <DropdownMenuItem
                  key={row.label}
                  onSelect={() =>
                    onFiltersChange({
                      ...filters,
                      assignee: row.value || undefined,
                    })
                  }
                >
                  {row.label}
                  {!filters.assignee && row.value === "" ? <Check className="ml-auto" /> : null}
                  {filters.assignee === row.value ? <Check className="ml-auto" /> : null}
                </DropdownMenuItem>
              ))}

              <DropdownMenuSeparator />
              <DropdownMenuLabel>Stage</DropdownMenuLabel>
              {STAGES.map((row) => (
                <DropdownMenuItem
                  key={row.key}
                  onSelect={() =>
                    onFiltersChange({
                      ...filters,
                      interest: row.interest,
                      followUp: row.followUp,
                    })
                  }
                >
                  {row.label}
                  {stageInForce(row, filters) ? (
                    <Check className="ml-auto" />
                  ) : null}
                </DropdownMenuItem>
              ))}

              {filtered ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() =>
                      onFiltersChange({ search: filters.search })
                    }
                  >
                    Clear filters
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* The header and the search pill are one 100px block, the same height
          as the thread's header, so the hairline between the panes runs
          straight across instead of stepping down at the divider. */}
      <div className="shrink-0 px-3 pb-2">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={field}
            aria-label="Search conversations"
            className="h-9 w-full rounded-full border border-transparent bg-secondary/70 pr-9 pl-9 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:border-brand/40 focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-brand/10"
            placeholder="Search name, number or message"
            type="text"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => {
                onSearchChange("");
                field.current?.focus();
              }}
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
        {loading && conversations.length === 0 ? (
          <p className="grid place-items-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </p>
        ) : null}

        {!loading && conversations.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px] leading-relaxed text-muted-foreground">
            {filters.search ||
            filters.status ||
            filters.assignee ||
            filters.interest ||
            filters.followUp
              ? "No conversation matches these filters."
              : "No conversations yet. A customer's first message opens one."}
          </p>
        ) : null}

        <ul className="pb-2">
          {groups.map((group) => (
            <li key={group.key}>
              <p className="px-3.5 pt-3 pb-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {group.label}
              </p>

              <ul>
                {group.rows.map((conversation) => {
                  const selected = conversation.id === selectedId;
                  const unread = conversation.unreadCount > 0;

                  return (
                    <li key={conversation.id}>
                      <button
                        type="button"
                        aria-current={selected ? "true" : undefined}
                        className={cn(
                          "relative flex w-full items-center gap-3 py-3 pr-3 pl-3.5 text-left transition-colors",
                          selected ? "bg-brand-soft" : "hover:bg-accent",
                        )}
                        onClick={() => onSelect(conversation.id)}
                      >
                        {selected ? (
                          <span
                            aria-hidden="true"
                            className="absolute top-3 bottom-3 left-1 w-[3px] rounded-full bg-brand"
                          />
                        ) : null}

                        <span
                          className={cn(
                            "grid size-10 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold",
                            unread
                              ? "bg-brand text-brand-foreground"
                              : "bg-secondary text-muted-foreground",
                          )}
                        >
                          {initials(
                            conversation.contact.name,
                            conversation.contact.waId,
                          )}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span
                              className={cn(
                                "truncate text-[13px] leading-tight text-foreground",
                                unread ? "font-semibold" : "font-medium",
                              )}
                            >
                              {conversation.contact.name ??
                                displayPhone(conversation.contact.waId)}
                            </span>
                          </span>

                          <span className="mt-1 flex items-center gap-1.5">
                            <span
                              className={cn(
                                "truncate text-[11.5px]",
                                unread
                                  ? "text-foreground/80"
                                  : "text-muted-foreground",
                              )}
                            >
                              {conversation.lastMessagePreview ??
                                "No messages yet"}
                            </span>

                            {conversation.interest !== "UNKNOWN" ? (
                              <span
                                className={cn(
                                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                  conversation.interest === "INTERESTED"
                                    ? "bg-brand-soft text-brand"
                                    : "bg-secondary text-muted-foreground",
                                )}
                              >
                                {INTEREST_LABELS[conversation.interest]}
                              </span>
                            ) : null}

                            {unread ? (
                              <span className="ml-auto grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-foreground tabular-nums">
                                {conversation.unreadCount > 99
                                  ? "99+"
                                  : conversation.unreadCount}
                              </span>
                            ) : conversation.status !== "OPEN" ? (
                              <span
                                className={cn(
                                  "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                  conversation.status === "PENDING"
                                    ? "bg-warning-soft text-warning"
                                    : "bg-secondary text-muted-foreground",
                                )}
                              >
                                {conversation.status === "PENDING"
                                  ? "Pending"
                                  : "Closed"}
                              </span>
                            ) : null}
                          </span>

                          {/* The time gets its own line. On the name row it
                              competed for width with the name and read as part
                              of it; here it sits under the preview, aligned to
                              the row's edge the way WhatsApp stacks it. */}
                          <span
                            className={cn(
                              "mt-0.5 block text-right text-[10px] tabular-nums",
                              unread
                                ? "font-semibold text-brand"
                                : "text-muted-foreground",
                            )}
                          >
                            {relativeTime(conversation.lastMessageAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
