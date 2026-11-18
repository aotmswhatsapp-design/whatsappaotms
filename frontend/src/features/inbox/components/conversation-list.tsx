"use client";

import * as React from "react";
import { Check, ChevronDown, ListFilter, Loader2, Search } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  type Conversation,
  type ConversationFilters,
  type ConversationStatus,
} from "../api";
import { displayPhone, initials, relativeTime } from "../format";

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

  const filtered = Boolean(filters.status || filters.assignee);
  const summary = filtered ? `${statusLabel} · ${assigneeLabel}` : "All chats";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        <p className="text-sm font-semibold text-foreground">Chats</p>
        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground tabular-nums">
          {conversations.length}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Filter conversations — ${summary}`}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition-colors outline-none",
                  "hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  filtered ? "bg-brand-soft text-brand" : "text-muted-foreground",
                )}
              >
                <ListFilter aria-hidden="true" className="size-4" />
                <span className="hidden min-w-0 truncate sm:inline">{summary}</span>
                <ChevronDown aria-hidden="true" className="size-3.5 opacity-60" />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56">
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

      <div className="relative shrink-0 px-3 py-2.5">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-6 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          aria-label="Search conversations"
          className="h-9 w-full rounded-lg border border-border bg-secondary/40 pr-3 pl-10 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
          placeholder="Search name, number or message"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/60">
        {loading && conversations.length === 0 ? (
          <p className="grid place-items-center py-12">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </p>
        ) : null}

        {!loading && conversations.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] leading-relaxed text-muted-foreground">
            {filters.search || filters.status || filters.assignee
              ? "No conversation matches these filters."
              : "No conversations yet. A customer's first message opens one."}
          </p>
        ) : null}

        <ul>
          {conversations.map((conversation) => {
            const selected = conversation.id === selectedId;

            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "flex w-full gap-3 px-3 py-3 text-left transition-colors",
                    "border-b border-border/50 last:border-b-0",
                    selected ? "bg-brand-soft/60" : "hover:bg-accent/60",
                  )}
                  onClick={() => onSelect(conversation.id)}
                >
                  <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-[12px] font-semibold text-foreground">
                    {initials(
                      conversation.contact.name,
                      conversation.contact.waId,
                    )}
                    {conversation.unreadCount > 0 ? (
                      <span
                        aria-hidden="true"
                        className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-brand ring-2 ring-card"
                      />
                    ) : null}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13.5px] font-semibold text-foreground">
                        {conversation.contact.name ??
                          displayPhone(conversation.contact.waId)}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[10.5px] tabular-nums",
                          conversation.unreadCount > 0
                            ? "font-semibold text-brand"
                            : "text-muted-foreground",
                        )}
                      >
                        {relativeTime(conversation.lastMessageAt)}
                      </span>
                    </span>

                    <span className="mt-1 flex items-center justify-between gap-2">
                      <span className="truncate text-[12px] text-muted-foreground">
                        {conversation.lastMessagePreview ?? "No messages yet"}
                      </span>

                      {conversation.unreadCount > 0 ? (
                        <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-foreground tabular-nums">
                          {conversation.unreadCount > 99
                            ? "99+"
                            : conversation.unreadCount}
                        </span>
                      ) : conversation.status !== "OPEN" ? (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                            conversation.status === "PENDING"
                              ? "bg-warning-soft text-warning"
                              : "bg-secondary text-muted-foreground",
                          )}
                        >
                          {conversation.status === "PENDING" ? "Pending" : "Closed"}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
