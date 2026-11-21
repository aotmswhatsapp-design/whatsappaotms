"use client";

import * as React from "react";
import Link from "next/link";
import { Inbox, Loader2 } from "lucide-react";

import { StatusDot } from "@/components/ui/status-dot";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/workspace/empty-state";
import { cn } from "@/lib/utils";

import {
  ApiError,
  fetchAgents,
  fetchConversations,
  fetchSummary,
  fetchThread,
  markRead,
  type Conversation,
  type ConversationFilters,
  type InboxAgent,
  type InboxMessage,
  type InboxNote,
  type InboxSummary,
  type ThreadPayload,
} from "../api";
import { ConversationList } from "./conversation-list";
import { MessageThread } from "./message-thread";

/** How often the open thread asks for new messages. */
const THREAD_POLL_MS = 3_000;
const SEARCH_DEBOUNCE_MS = 300;

/** Bounds for the queue pane. Narrower clips the preview; wider starves the thread. */
const LIST_DEFAULT = 392;
const LIST_MIN = 320;
const LIST_MAX = 640;

/**
 * The inbox's client boundary: it owns the queue, the open thread and the
 * polling, and each panel stays presentational.
 *
 * Realtime is polling because `EventSource` cannot carry the bearer token the
 * API requires; three seconds is below the point where a reply feels late.
 */
export function InboxView() {
  const [summary, setSummary] = React.useState<InboxSummary | null>(null);
  const [agents, setAgents] = React.useState<InboxAgent[]>([]);
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [thread, setThread] = React.useState<ThreadPayload | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<ConversationFilters>({});

  const [booted, setBooted] = React.useState(false);
  const [listLoading, setListLoading] = React.useState(true);
  const [threadLoading, setThreadLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // The queue's width belongs to the divider, so it lives in state rather than
  // CSS: dragging has to survive re-renders without snapping back.
  const [listWidth, setListWidth] = React.useState(LIST_DEFAULT);
  const drag = React.useRef<{ x: number; width: number } | null>(null);

  // The polling and action callbacks need the current filters without being
  // re-created every time a select changes.
  const filtersRef = React.useRef(filters);
  React.useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const refreshList = React.useCallback(async (): Promise<void> => {
    try {
      const next = await fetchConversations(filtersRef.current);
      setConversations(next.conversations);
    } catch {
      // A failed background refresh keeps the rows already on screen.
    }
  }, []);

  const refreshSummary = React.useCallback(async (): Promise<void> => {
    try {
      setSummary(await fetchSummary());
    } catch {
      // Same: the header may lag a moment rather than disappearing.
    }
  }, []);

  // First paint: channel + agents decide what the page can show at all.
  React.useEffect(() => {
    let active = true;

    Promise.all([fetchSummary(), fetchAgents()])
      .then(([nextSummary, nextAgents]) => {
        if (!active) return;
        setSummary(nextSummary);
        setAgents(nextAgents.agents);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) setError(readError(cause));
      })
      .finally(() => {
        if (active) setBooted(true);
      });

    return () => {
      active = false;
    };
  }, []);

  // Typing is debounced; everything else filters immediately.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const term = search.trim() || undefined;

      setFilters((current) =>
        current.search === term ? current : { ...current, search: term },
      );
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [search]);

  React.useEffect(() => {
    let active = true;

    fetchConversations(filters)
      .then((next) => {
        if (active) setConversations(next.conversations);
      })
      .catch((cause: unknown) => {
        if (active) setError(readError(cause));
      })
      .finally(() => {
        if (active) setListLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters]);

  // While a thread is open, poll it. Stopping is part of the cleanup, so a
  // fast switch between conversations cannot leave two timers running.
  React.useEffect(() => {
    if (!selectedId) return;

    let active = true;
    let timer = 0;

    const tick = async (): Promise<void> => {
      try {
        const next = await fetchThread(selectedId);
        if (active) setThread((current) => mergeThread(current, next));
      } catch {
        // Polling is best effort; the next tick tries again.
      }

      if (active) timer = window.setTimeout(tick, THREAD_POLL_MS);
    };

    timer = window.setTimeout(tick, THREAD_POLL_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [selectedId]);

  const openConversation = React.useCallback(
    async (id: string): Promise<void> => {
      setSelectedId(id);
      setThread(null);
      setThreadLoading(true);
      setError(null);

      try {
        const next = await fetchThread(id);
        setThread(next);

        if (next.conversation.unreadCount > 0) {
          await markRead(id).catch(() => undefined);

          setConversations((rows) =>
            rows.map((row) =>
              row.id === id ? { ...row, unreadCount: 0 } : row,
            ),
          );
          setSummary((current) =>
            current
              ? {
                  ...current,
                  unread: Math.max(
                    0,
                    current.unread - next.conversation.unreadCount,
                  ),
                }
              : current,
          );
        }
      } catch (cause) {
        setError(readError(cause));
      } finally {
        setThreadLoading(false);
      }
    },
    [],
  );

  function handleSent(message: InboxMessage): void {
    setThread((current) =>
      current
        ? {
            ...current,
            messages: [...current.messages, message],
            conversation: {
              ...current.conversation,
              lastMessageAt: message.createdAt,
              lastMessagePreview: message.body ?? "[attachment]",
            },
          }
        : current,
    );

    void refreshList();
  }

  function handleNoted(note: InboxNote): void {
    setThread((current) =>
      current ? { ...current, notes: [...current.notes, note] } : current,
    );
  }

  function handleChanged(conversation: Conversation): void {
    setThread((current) =>
      current?.conversation.id === conversation.id
        ? { ...current, conversation }
        : current,
    );
    setConversations((rows) =>
      rows.map((row) => (row.id === conversation.id ? conversation : row)),
    );
  }

  function handleDeleted(): void {
    setSelectedId(null);
    setThread(null);
    void refreshList();
    void refreshSummary();
  }

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    drag.current = { x: event.clientX, width: listWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: React.PointerEvent<HTMLDivElement>): void {
    const origin = drag.current;

    if (!origin) return;

    setListWidth(clampWidth(origin.width + event.clientX - origin.x));
  }

  function stopResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (!drag.current) return;

    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  /** The divider is focusable, so it must answer the keyboard too. */
  function nudge(event: React.KeyboardEvent<HTMLDivElement>): void {
    const step =
      event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;

    if (step === 0) return;

    event.preventDefault();
    setListWidth((width) => clampWidth(width + step));
  }

  if (!booted) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !summary) {
    return (
      <EmptyState
        description={error}
        icon={Inbox}
        title="The inbox could not be loaded"
      />
    );
  }

  if (!summary?.channel) {
    return (
      <EmptyState
        description="The inbox reads and replies from the number you connect on the WhatsApp page. Connect it once and every customer message lands here."
        icon={Inbox}
        title="Connect a WhatsApp number"
        action={
          <Button asChild variant="brand">
            <Link href="/workspace/whatsapp">Connect WhatsApp</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div
      // One card for the whole screen: the shell leaves this box the space
      // below the title, and only the two panes scroll inside it.
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card"
      style={{ "--inbox-list": `${listWidth}px` } as React.CSSProperties}
    >
      {/* The channel and the counts used to float above the card as a loose
          line, which cost a whole band of height and left the panel reading as
          a widget on a page. As the card's own top bar they are the window's
          title strip instead. */}
      <div className="flex shrink-0 items-center justify-between gap-2.5 border-b border-border px-3 py-1.5 text-[11.5px] text-muted-foreground sm:px-4">
        <span className="inline-flex min-w-0 items-center gap-2">
          <StatusDot
            label={summary.channel.live ? "Receiving" : "Waiting for Meta"}
            tone={summary.channel.live ? "live" : "pending"}
          />
          <span className="truncate font-medium text-foreground">
            {summary.channel.verifiedName ?? "WhatsApp"}
          </span>
          {summary.channel.display ? (
            <span className="hidden truncate sm:inline">
              {summary.channel.display}
            </span>
          ) : null}
          <span className="hidden shrink-0 md:inline">
            {summary.channel.live ? "receiving" : "awaiting webhook"}
          </span>
        </span>

        <span className="shrink-0 tabular-nums">
          {summary.counts.open} open · {summary.counts.pending} pending ·{" "}
          {summary.unread} unread
        </span>
      </div>

      {error ? (
        <p className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-1.5 text-[12px] leading-relaxed text-destructive sm:px-4">
          {error}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            // The split needs room for both panes, so it starts at xl; below
            // that one pane at a time, the way a phone reads it.
            "min-h-0 min-w-0 flex-col border-border",
            "w-full xl:w-[var(--inbox-list)] xl:flex-none xl:border-r",
            selectedId ? "hidden xl:flex" : "flex",
          )}
        >
          <ConversationList
            conversations={conversations}
            filters={filters}
            loading={listLoading}
            search={search}
            selectedId={selectedId}
            unread={summary.unread}
            onFiltersChange={setFilters}
            onSearchChange={setSearch}
            onSelect={(id) => void openConversation(id)}
          />
        </div>

        <div
          role="separator"
          aria-label="Resize the conversation list"
          aria-orientation="vertical"
          aria-valuemax={LIST_MAX}
          aria-valuemin={LIST_MIN}
          aria-valuenow={listWidth}
          tabIndex={0}
          className="group hidden w-2 shrink-0 cursor-col-resize touch-none items-center justify-center outline-none transition-colors focus-visible:bg-brand/10 xl:flex"
          onKeyDown={nudge}
          onPointerCancel={stopResize}
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={stopResize}
        >
          <span
            aria-hidden="true"
            className="h-12 w-px rounded-full bg-border transition-colors group-hover:bg-brand/50 group-focus-visible:bg-brand/60"
          />
        </div>

        <div
          className={cn(
            "min-h-0 min-w-0 flex-1",
            selectedId ? "block" : "hidden xl:block",
          )}
        >
          <MessageThread
            agents={agents}
            loading={threadLoading}
            thread={thread}
            onBack={() => setSelectedId(null)}
            onChanged={handleChanged}
            onDeleted={handleDeleted}
            onMessage={handleSent}
            onNote={handleNoted}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * A poll that started before the agent sent a message can land just after it.
 * Keeping the longer list means the echo of their own message never blinks out.
 */
function mergeThread(
  current: ThreadPayload | null,
  next: ThreadPayload,
): ThreadPayload {
  if (!current || current.conversation.id !== next.conversation.id) return next;

  return {
    conversation: next.conversation,
    messages:
      next.messages.length >= current.messages.length
        ? next.messages
        : current.messages,
    notes: next.notes.length >= current.notes.length ? next.notes : current.notes,
  };
}

function readError(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "The inbox could not be read. Try again.";
}

function clampWidth(width: number): number {
  return Math.min(LIST_MAX, Math.max(LIST_MIN, width));
}
