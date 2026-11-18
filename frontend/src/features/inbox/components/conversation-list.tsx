"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  type Conversation,
  type ConversationFilters,
  type ConversationStatus,
} from "../api";
import { displayPhone, initials, relativeTime } from "../format";

/**
 * The queue. Filters are owned by the parent so a refresh keeps them, and the
 * row is a button — not a div with a click handler — so keyboard navigation
 * works without extra ARIA.
 */
export function ConversationList({
  conversations,
  selectedId,
  loading,
  filters,
  search,
  unread,
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
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
            Conversations
          </p>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              unread > 0
                ? "bg-brand text-brand-foreground"
                : "bg-secondary text-muted-foreground",
            )}
          >
            {unread > 0 ? `${unread} unread` : conversations.length}
          </span>
        </div>

        <div className="relative mt-2.5">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            aria-label="Search conversations"
            className="h-8 w-full rounded-md border border-border bg-card pr-2 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            placeholder="Search name, number or message"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>

        <div className="mt-2 flex gap-2">
          <select
            aria-label="Filter by status"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-[12px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            value={filters.status ?? ""}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                status: (event.target.value || undefined) as
                  | ConversationStatus
                  | undefined,
              })
            }
          >
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="PENDING">Pending</option>
            <option value="CLOSED">Closed</option>
          </select>

          <select
            aria-label="Filter by assignee"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-[12px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            value={filters.assignee ?? ""}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                assignee: event.target.value || undefined,
              })
            }
          >
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
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
                    "flex w-full gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors",
                    selected ? "bg-brand-soft/70" : "hover:bg-accent/50",
                  )}
                  onClick={() => onSelect(conversation.id)}
                >
                  <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-foreground">
                    {initials(
                      conversation.contact.name,
                      conversation.contact.waId,
                    )}
                    {conversation.unreadCount > 0 ? (
                      <span
                        aria-hidden="true"
                        className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-brand ring-2 ring-background"
                      />
                    ) : null}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground">
                        {conversation.contact.name ??
                          displayPhone(conversation.contact.waId)}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-muted-foreground">
                        {relativeTime(conversation.lastMessageAt)}
                      </span>
                    </span>

                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[12px] text-muted-foreground">
                        {conversation.lastMessagePreview ?? "No messages yet"}
                      </span>

                      {conversation.unreadCount > 0 ? (
                        <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-foreground">
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
