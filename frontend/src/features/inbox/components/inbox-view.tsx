"use client";

import * as React from "react";
import { Inbox, Loader2 } from "lucide-react";

import { StatusDot } from "@/components/ui/status-dot";
import { useAccess } from "@/components/workspace/access-provider";
import { ConnectWhatsAppAction } from "@/components/workspace/connect-whatsapp";
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
/** The queue and the header refresh on their own beat; both are heavier queries. */
const QUEUE_POLL_MS = 5_000;
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
export function InboxView({
  initialConversationId,
  viewerId,
}: {
  /** `/workspace/inbox?conversation=<id>`, from a run's `Open` link. */
  initialConversationId?: string;
  /** The signed-in member; the thread's own queue is scoped by the server. */
  viewerId?: string | null;
}) {
  const { role } = useAccess();
  const owner = role === "OWNER";

  const [summary, setSummary] = React.useState<InboxSummary | null>(null);
  const [agents, setAgents] = React.useState<InboxAgent[]>([]);
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [thread, setThread] = React.useState<ThreadPayload | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialConversationId ?? null,
  );

  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<ConversationFilters>({});

  const [booted, setBooted] = React.useState(false);
  const [listLoading, setListLoading] = React.useState(true);
  const [threadLoading, setThreadLoading] = React.useState(
    initialConversationId !== undefined,
  );
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

  /**
   * The bubbles this agent hid, by id. The server already leaves them out, but
   * a poll that was in flight when the hide landed still carries them, so the
   * ids are filtered again after every merge and cleared when the thread
   * changes.
   */
  const hiddenRef = React.useRef<Set<string>>(new Set());

  /** The thread on screen. The polls read it without being re-created. */
  const selectedRef = React.useRef<string | null>(selectedId);

  /**
   * Threads whose read receipt is in flight. Opening a conversation and a poll
   * landing in the same second must not send two receipts, nor lose the second.
   */
  const readingRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  /**
   * Marks a conversation read — here and on the server — and takes its number
   * off the header count.
   *
   * The queue is its own snapshot, taken on a different beat: a customer who
   * writes while the thread is open puts the badge back, and a list read that
   * left before the first receipt landed puts it back too. Both are answered by
   * asking again whenever the server still says the open thread is unread — a
   * conversation you are looking at is read, and stays read.
   */
  const settleRead = React.useCallback((id: string, unread: number): void => {
    if (unread <= 0 || readingRef.current.has(id)) return;

    readingRef.current.add(id);

    void (async () => {
      try {
        await markRead(id).catch(() => undefined);

        setConversations((rows) =>
          rows.map((row) => (row.id === id ? { ...row, unreadCount: 0 } : row)),
        );
        setSummary((current) =>
          current && current.unread > 0
            ? { ...current, unread: Math.max(0, current.unread - unread) }
            : current,
        );
      } finally {
        readingRef.current.delete(id);
      }
    })();
  }, []);

  const refreshList = React.useCallback(async (): Promise<void> => {
    try {
      const next = await fetchConversations(filtersRef.current);
      const open = selectedRef.current;

      // Drawn without the badge even when this snapshot left the server before
      // the receipt landed — the thread on screen is being read either way.
      setConversations(
        next.conversations.map((row) =>
          row.id === open && row.unreadCount > 0
            ? { ...row, unreadCount: 0 }
            : row,
        ),
      );

      const row = next.conversations.find((item) => item.id === open);
      if (row) settleRead(row.id, row.unreadCount);
    } catch {
      // A failed background refresh keeps the rows already on screen.
    }
  }, [settleRead]);

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

  /**
   * How many answers this screen has installed for the open thread. A read
   * remembers the value it saw when it was issued and drops its answer if the
   * screen moved on meanwhile: the write's own answer is newer than anything
   * a read that started before it could return. The poll moves the counter
   * when it starts as well as when it lands, so a poll arriving first is not
   * overwritten by a refresh that began before it. Without the stamp, a poll
   * or a re-read still in flight can put a status back that a colleague's
   * change (or our own) already replaced.
   */
  const revision = React.useRef(0);

  // While a thread is open, poll it. Stopping is part of the cleanup, so a
  // fast switch between conversations cannot leave two timers running.
  React.useEffect(() => {
    if (!selectedId) return;

    let active = true;
    let timer = 0;

    const tick = async (): Promise<void> => {
      // Starting the poll also moves the counter: every read issued before it
      // is older than what this poll will return, and must not land after it.
      const at = ++revision.current;

      try {
        const next = await fetchThread(selectedId);

        if (active && revision.current === at) {
          setThread((current) =>
            withoutHidden(hiddenRef.current, mergeThread(current, next)),
          );
          // A message that arrived while this thread was on screen is read.
          settleRead(selectedId, next.conversation.unreadCount);
        }
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
  }, [selectedId, settleRead]);

  // Nothing is pushed to the browser, so the queue and the unread counters
  // refresh themselves while the page is open. Without this, a message from a
  // customer who is not the open thread — and every new conversation — only
  // appeared after a reload.
  React.useEffect(() => {
    let active = true;
    let timer = 0;

    const tick = async (): Promise<void> => {
      await Promise.all([refreshList(), refreshSummary()]);

      if (active) timer = window.setTimeout(tick, QUEUE_POLL_MS);
    };

    timer = window.setTimeout(tick, QUEUE_POLL_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [refreshList, refreshSummary]);

  const openConversation = React.useCallback(
    async (id: string): Promise<void> => {
      setSelectedId(id);
      setThread(null);
      setThreadLoading(true);
      setError(null);
      hiddenRef.current = new Set();

      try {
        const next = await fetchThread(id);
        setThread(next);
        settleRead(id, next.conversation.unreadCount);
      } catch (cause) {
        setError(readError(cause));
      } finally {
        setThreadLoading(false);
      }
    },
    [settleRead],
  );

  // The link carries an id, not a loaded thread. It is opened from a timer
  // rather than straight from the effect for the same reason the polls above
  // are: opening sets the thread's own state, and React's lint rules reject a
  // state update inside an effect body. `openConversation` is memoised on a
  // stable callback, so this runs once per linked id.
  React.useEffect(() => {
    if (!initialConversationId) return;

    const timer = window.setTimeout(() => {
      void openConversation(initialConversationId);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [initialConversationId, openConversation]);

  function handleSent(message: InboxMessage, ahead: InboxMessage[] = []): void {
    setThread((current) =>
      current
        ? {
            ...current,
            // The files and pictures arrive first, then the card that hands
            // them over, which is the order the customer's phone shows.
            messages: [...current.messages, ...ahead, message],
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

  /**
   * Meta keeps one reaction per sender per message, so a new chip retires ours
   * on the same target and a removal leaves nothing at all. The server has
   * already made that change; this mirrors it so the bubble agrees before the
   * next poll catches up.
   */
  function handleReaction(targetId: string, message: InboxMessage | null): void {
    setThread((current) => {
      if (!current) return current;

      const kept = current.messages.filter(
        (row) =>
          !(
            row.direction === "OUTBOUND" &&
            row.kind === "REACTION" &&
            row.quotedMessageId === targetId
          ),
      );

      return { ...current, messages: message ? [...kept, message] : kept };
    });
  }

  function handleChanged(conversation: Conversation): void {
    // A write's answer is the newest thing this screen has seen: anything a
    // read started before it returns must not replace it.
    revision.current += 1;

    setThread((current) =>
      current?.conversation.id === conversation.id
        ? { ...current, conversation }
        : current,
    );

    const open = conversation.id === selectedRef.current;

    setConversations((rows) =>
      rows.map((row) =>
        row.id === conversation.id
          ? { ...conversation, unreadCount: open ? 0 : conversation.unreadCount }
          : row,
      ),
    );
  }

  /**
   * A write the thread made itself — a stage change, or a follow-up closed.
   *
   * The row is re-read here, in the component that owns the data, so the
   * answer can be sequenced against the poll: `revision` moves first, and any
   * read still in flight from before the write is dropped when it comes back.
   * The re-read is what keeps a manual "not interested" from showing the
   * follow-up it cancelled server-side.
   */
  async function handleWritten(): Promise<void> {
    revision.current += 1;

    const id = selectedRef.current;
    if (!id) return;

    const at = revision.current;

    try {
      const next = await fetchThread(id);
      if (revision.current !== at || selectedRef.current !== id) return;
      handleChanged(next.conversation);
    } catch {
      // The poll reads the row on its next beat.
    }
  }

  /**
   * A hidden bubble leaves now rather than at the next poll, and the queue is
   * re-read because the conversation's preview may have changed with it.
   */
  function handleMessageHidden(messageId: string): void {
    hiddenRef.current.add(messageId);

    setThread((current) =>
      current
        ? {
            ...current,
            messages: current.messages.filter((row) => row.id !== messageId),
          }
        : current,
    );

    void refreshList();
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
      <div className="grid h-full place-items-center bg-card">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="grid h-full place-items-center p-6">
        <EmptyState
          className="w-full max-w-md"
          description={error}
          icon={Inbox}
          title="The inbox could not be loaded"
        />
      </div>
    );
  }

  if (!summary?.channel) {
    return (
      <div className="grid h-full place-items-center p-6">
        <EmptyState
          action={<ConnectWhatsAppAction />}
          className="w-full max-w-md"
          description={
            owner
              ? "The inbox reads and replies from the number you connect on the WhatsApp page. Connect it once and every customer message lands here."
              : "The workspace owner has not connected the WhatsApp number yet. Once it is in, customer messages land here — you work the owner's number, never one of your own."
          }
          icon={Inbox}
          title={
            owner ? "Connect a WhatsApp number" : "No WhatsApp number connected"
          }
        />
      </div>
    );
  }

  return (
    <div
      // One card for the whole screen, filling the height the route hands it.
      // `h-full` rather than a viewport sum of its own: the route already owns
      // the geometry, and two places computing the same height is how a card
      // ends up a few pixels short of its frame.
      //
      // No border and no radius. Flush against the top bar and the sidebar, the
      // shell's own hairlines are the only edges on screen; a rounded corner
      // here would read as a widget floating on the page instead.
      //
      // `data-theme="inbox"` is what makes this card read as WhatsApp rather
      // than as the rest of the app: the scope in `globals.css` swaps the warm
      // roles for white, chat grey and green, and it stops at the card's edge,
      // so the sidebar behind it keeps the teal palette.
      data-theme="inbox"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-card"
      style={{ "--inbox-list": `${listWidth}px` } as React.CSSProperties}
    >
      {/* The channel and the counts used to float above the card as a loose
          line, which cost a whole band of height and left the panel reading as
          a widget on a page. As the card's own top bar they are the window's
          title strip instead. */}
      <div className="flex shrink-0 items-center justify-between gap-2.5 border-b border-border px-3 py-2 text-[11px] text-muted-foreground sm:px-4">
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
        <p className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-[11.5px] leading-relaxed text-destructive sm:px-4">
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
            viewerId={viewerId}
            onBack={() => setSelectedId(null)}
            onChanged={handleChanged}
            onWritten={() => void handleWritten()}
            onDeleted={handleDeleted}
            onMessage={handleSent}
            onMessageHidden={handleMessageHidden}
            onNote={handleNoted}
            onReaction={handleReaction}
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

/**
 * Drops the bubbles this agent hid. Applied after the merge above, because the
 * merge can prefer the client's longer list — which is exactly the list that
 * still holds a message the server has already hidden.
 */
function withoutHidden(
  hidden: Set<string>,
  thread: ThreadPayload | null,
): ThreadPayload | null {
  if (!thread || hidden.size === 0) return thread;

  const messages = thread.messages.filter((row) => !hidden.has(row.id));

  return messages.length === thread.messages.length
    ? thread
    : { ...thread, messages };
}

function readError(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "The inbox could not be read. Try again.";
}

function clampWidth(width: number): number {
  return Math.min(LIST_MAX, Math.max(LIST_MIN, width));
}
