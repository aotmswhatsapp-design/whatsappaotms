"use client";

import * as React from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  Clock,
  Inbox,
  LayoutTemplate,
  Loader2,
  MoreHorizontal,
  StickyNote,
  Trash2,
} from "lucide-react";

import { EmptyState } from "@/components/workspace/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  ApiError,
  removeConversation,
  updateConversation,
  type Conversation,
  type ConversationStatus,
  type InboxAgent,
  type InboxMessage,
  type InboxNote,
  type ThreadPayload,
} from "../api";
import { Composer } from "./composer";
import {
  clockTime,
  dayKey,
  dayLabel,
  displayPhone,
  initials,
  windowCountdown,
} from "../format";
import { MessageLabel, MessageMedia } from "./message-media";

type Entry =
  | { kind: "message"; at: string; message: InboxMessage }
  | { kind: "note"; at: string; note: InboxNote };

/** The status rows for the phone menu. On wider screens the select itself is
    the control, so this list is only read below `sm`. */
const STATUS_ROWS: { value: ConversationStatus; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "PENDING", label: "Pending" },
  { value: "CLOSED", label: "Closed" },
];

/**
 * The open conversation: header controls, the interleaved message/note
 * timeline, and the composer. The parent owns the data and polling; this
 * component only decides what it looks like.
 */
export function MessageThread({
  thread,
  agents,
  loading,
  onBack,
  onChanged,
  onMessage,
  onNote,
  onDeleted,
}: {
  thread: ThreadPayload | null;
  agents: InboxAgent[];
  loading: boolean;
  onBack: () => void;
  onChanged: (conversation: Conversation) => void;
  onMessage: (message: InboxMessage) => void;
  onNote: (note: InboxNote) => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const scroller = React.useRef<HTMLDivElement>(null);
  const [deleting, setDeleting] = React.useState(false);

  const entries = React.useMemo<Entry[]>(() => {
    if (!thread) return [];

    return [
      ...thread.messages.map((message) => ({
        kind: "message" as const,
        at: message.createdAt,
        message,
      })),
      ...thread.notes.map((note) => ({
        kind: "note" as const,
        at: note.createdAt,
        note,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
  }, [thread]);

  const count = thread ? thread.messages.length + thread.notes.length : 0;

  // A new message should be visible without the agent scrolling for it.
  React.useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [count, thread?.conversation.id]);

  if (!thread) {
    if (loading) {
      return (
        <div className="grid h-full place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    return (
      <div className="grid h-full place-items-center p-6">
        <EmptyState
          className="w-full max-w-sm border-0 bg-transparent"
          description="Pick a conversation on the left to read the history and reply."
          icon={Inbox}
          title="No conversation selected"
        />
      </div>
    );
  }

  const conversation = thread.conversation;

  async function patch(next: {
    status?: ConversationStatus;
    assignedToUserId?: string | null;
  }): Promise<void> {
    if (!thread) return;

    try {
      const result = await updateConversation(thread.conversation.id, next);
      onChanged(result.conversation);
    } catch (error) {
      toast.push({
        title: "Could not update",
        description: errorText(error),
        tone: "error",
      });
    }
  }

  async function remove(): Promise<void> {
    if (!thread) return;

    const sure = window.confirm(
      "Delete this conversation, its messages and its attachments? This cannot be undone.",
    );

    if (!sure) return;

    setDeleting(true);

    try {
      await removeConversation(thread.conversation.id);
      toast.push({ title: "Conversation deleted", tone: "success" });
      onDeleted();
    } catch (error) {
      toast.push({
        title: "Could not delete",
        description: errorText(error),
        tone: "error",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* One row, the shape of the phone app: who you are talking to, the
          number and the reply window on the subline, then the assignment
          controls and the actions pinned right. The queue keeps its taller
          header, so this bar ends above the queue's — WhatsApp Web does
          exactly the same, and a stepped divider reads as two panes rather
          than as one broken one.

          The bar is the card's own surface now, and a hairline underneath is
          the only thing dividing it from the thread. Every control carries
          dark ink: the chips sit on the secondary plate and the avatar on the
          same one, because white-on-white would erase both. */}
      <header className="shrink-0 border-b border-border bg-card text-foreground">
        <div className="flex h-14 min-w-0 items-center gap-2.5 pr-2 pl-2 sm:pl-3">
          <button
            type="button"
            aria-label="Back to conversations"
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 xl:hidden"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
          </button>

          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-[11.5px] font-semibold text-foreground">
            {initials(conversation.contact.name, conversation.contact.waId)}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] leading-tight font-semibold text-foreground">
              {conversation.contact.name ??
                displayPhone(conversation.contact.waId)}
            </p>
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              {/* An unnamed contact already uses the number as the title, so
                  repeating it here would just say the same thing twice. */}
              {conversation.contact.name ? (
                <>
                  <span className="truncate">
                    {displayPhone(
                      conversation.contact.phone ?? conversation.contact.waId,
                    )}
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-muted-foreground/50">
                    ·
                  </span>
                </>
              ) : null}
              <WindowCountdown lastInboundAt={conversation.lastInboundAt} />
            </p>
          </div>

          {/* Assignment shares this row from 640px up, immediately before the
              menu — this is the only line the header has now. Below that they
              leave: two native selects carry a min-content width equal to
              their longest option, so at 390px keeping them would squeeze the
              name to a couple of characters. On a phone the same two controls
              are menu items instead. */}
          <div className="hidden min-w-0 items-center gap-1.5 sm:flex">
            <Field>
              <select
                aria-label="Conversation status"
                className={cn(
                  "h-8 min-w-0 appearance-none rounded-full border border-border bg-secondary pr-6 pl-2.5 text-[11px] font-medium outline-none transition-colors",
                  "focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-ring/25",
                  conversation.status === "PENDING"
                    ? "text-warning"
                    : conversation.status === "CLOSED"
                      ? "text-muted-foreground"
                      : "text-foreground",
                )}
                value={conversation.status}
                onChange={(event) =>
                  void patch({ status: event.target.value as ConversationStatus })
                }
              >
                <option value="OPEN">Open</option>
                <option value="PENDING">Pending</option>
                <option value="CLOSED">Closed</option>
              </select>
            </Field>

            <Field>
              <select
                aria-label="Assigned agent"
                className={cn(
                  "h-8 max-w-40 min-w-0 appearance-none truncate rounded-full border border-border bg-secondary pr-6 pl-2.5 text-[11px] font-medium outline-none transition-colors",
                  "focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-ring/25",
                  conversation.assignedTo ? "text-foreground" : "text-muted-foreground",
                )}
                value={conversation.assignedTo?.id ?? ""}
                onChange={(event) =>
                  void patch({ assignedToUserId: event.target.value || null })
                }
              >
                <option value="">Unassigned</option>
                {agents.map((agent) => (
                  <option key={agent.userId} value={agent.userId}>
                    {agent.name ?? agent.email}
                  </option>
                ))}
                {conversation.assignedTo &&
                !agents.some(
                  (agent) => agent.userId === conversation.assignedTo?.id,
                ) ? (
                  <option value={conversation.assignedTo.id}>
                    {conversation.assignedTo.name ?? conversation.assignedTo.email}
                  </option>
                ) : null}
              </select>
            </Field>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Conversation actions"
                className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-40"
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <MoreHorizontal aria-hidden="true" className="size-4" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64" data-theme="inbox">
              {/* The phone header has no room for the two chips, so the same
                  controls are menu items here. Items rather than a native
                  select placed inside the menu: choosing an option opens an OS
                  popup outside the content, which reads as an outside click
                  and closes the menu mid-choice. */}
              <div className="sm:hidden">
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                {STATUS_ROWS.map((row) => (
                  <DropdownMenuItem
                    key={row.value}
                    onSelect={() => void patch({ status: row.value })}
                  >
                    <Check
                      aria-hidden="true"
                      className={
                        conversation.status === row.value
                          ? "opacity-100"
                          : "opacity-0"
                      }
                    />
                    {row.label}
                  </DropdownMenuItem>
                ))}

                <DropdownMenuLabel>Assigned to</DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() => void patch({ assignedToUserId: null })}
                >
                  <Check
                    aria-hidden="true"
                    className={conversation.assignedTo ? "opacity-0" : "opacity-100"}
                  />
                  Unassigned
                </DropdownMenuItem>
                {agents.map((agent) => (
                  <DropdownMenuItem
                    key={agent.userId}
                    onSelect={() => void patch({ assignedToUserId: agent.userId })}
                  >
                    <Check
                      aria-hidden="true"
                      className={
                        conversation.assignedTo?.id === agent.userId
                          ? "opacity-100"
                          : "opacity-0"
                      }
                    />
                    <span className="min-w-0 truncate">
                      {agent.name ?? agent.email}
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </div>

              <DropdownMenuItem
                className="text-destructive focus:bg-destructive/10 focus:text-destructive [&_svg]:text-destructive"
                onSelect={() => void remove()}
              >
                <Trash2 aria-hidden="true" />
                Delete conversation
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <p className="px-2.5 pb-1 text-[11px] leading-relaxed text-muted-foreground">
                Deleting removes the messages and any attachments for good.
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* The canvas is plain card white now. The wallpaper that used to fill
          it was deleted, and a solid fill left in its place read as a coloured
          panel rather than a chat. With no picture behind them, the inbound
          bubble needs its hairline or it dissolves into the background. */}
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto bg-card px-3 py-4 sm:px-4"
      >
        {/* A readable column inside the pane: at 1400px the thread is wider
            than any comfortable line length, and bubbles hugging opposite
            edges turn into a tennis match. The cap widens once with the pane
            so a 1920 window does not leave a gutter on both sides. */}
        <div className="mx-auto w-full max-w-[46rem] space-y-2 2xl:max-w-[60rem]">
          {entries.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              Nothing in this thread yet.
            </p>
          ) : null}

          {entries.map((entry, index) => {
            const previous = index > 0 ? entries[index - 1].at : null;
            const newDay =
              previous === null || dayKey(previous) !== dayKey(entry.at);

            return (
              <React.Fragment
                key={`${entry.kind}-${entry.kind === "message" ? entry.message.id : entry.note.id}`}
              >
                {newDay ? (
                  <div className="flex justify-center py-2">
                    <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {dayLabel(entry.at)}
                    </span>
                  </div>
                ) : null}

                {entry.kind === "message" ? (
                  <Bubble message={entry.message} />
                ) : (
                  <NoteCard note={entry.note} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <Composer conversation={conversation} onSent={onMessage} onNoted={onNote} />
    </div>
  );
}

function Bubble({ message }: { message: InboxMessage }) {
  const outbound = message.direction === "OUTBOUND";

  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          // WhatsApp draws the sender in green and the customer in white, with
          // the ink staying dark on both — white type on #D9FDD3 is 1.2:1.
          // The corner nearest the sender's edge is squarer, which reads as a
          // tail without drawing an actual one.
          "max-w-[85%] rounded-xl px-3 py-2 text-[13.5px] shadow-xs sm:max-w-[75%]",
          outbound
            ? "rounded-br-sm bg-brand-soft text-foreground"
            : "rounded-bl-sm border border-border bg-card text-foreground",
        )}
      >
        {message.media ? (
          <div className="mb-1.5">
            <MessageMedia message={message} />
          </div>
        ) : null}

        {/* A location, a contact card or a button reply carries no file, so
            without this line those bubbles were rendered empty. */}
        <MessageLabel kind={message.kind} />

        {/* A template send says which template produced it, and — when the
            override was used — what the whole bubble opened. */}
        {message.template ? (
          <p className="mb-1 flex flex-wrap items-center gap-1 text-[10px] font-medium text-muted-foreground">
            <LayoutTemplate aria-hidden="true" className="size-3 shrink-0" />
            <span>Template · {message.template.name}</span>
            {message.template.tapTarget ? (
              <span className="text-muted-foreground/80">
                · tap opens “{message.template.tapTarget.title}”
              </span>
            ) : null}
          </p>
        ) : null}

        {message.body ? (
          <p className="mt-0.5 break-words whitespace-pre-wrap leading-relaxed">
            {message.body}
          </p>
        ) : null}

        {message.errorReason ? (
          <p className="mt-1 text-[11.5px] text-destructive">
            {message.errorReason}
          </p>
        ) : null}

        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
          <time dateTime={message.createdAt}>{clockTime(message.createdAt)}</time>
          {outbound ? <Tick status={message.status} /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The receipt. One tick is sent, two is delivered, two in blue is read — the
 * order WhatsApp users already know, so it needs no label in normal use; the
 * `aria-label` carries it for anyone who cannot see the colour.
 */
function Tick({ status }: { status: InboxMessage["status"] }) {
  if (status === "FAILED") {
    return (
      <CircleAlert aria-label="Not delivered" className="size-3.5 text-destructive" />
    );
  }

  if (status === "QUEUED") {
    return <Clock aria-label="Sending" className="size-3.5" />;
  }

  if (status === "SENT") {
    return <Check aria-label="Sent" className="size-3.5" />;
  }

  const read = status === "READ";

  return (
    <CheckCheck
      aria-label={read ? "Read" : "Delivered"}
      className={cn("size-3.5", read && "text-blue")}
    />
  );
}

function NoteCard({ note }: { note: InboxNote }) {
  return (
    <div className="flex justify-center">
      <div className="max-w-[85%] rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 sm:max-w-[75%]">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-warning uppercase">
          <StickyNote aria-hidden="true" className="size-3" />
          Internal note
          <span className="font-medium tracking-normal normal-case">
            · {note.author.name ?? "A teammate"}
          </span>
        </p>
        <p className="mt-1 text-[12px] break-words whitespace-pre-wrap text-foreground">
          {note.body}
        </p>
        <p className="mt-1 text-right text-[10px] text-warning/80">
          {clockTime(note.createdAt)}
        </p>
      </div>
    </div>
  );
}

/**
 * The 24-hour reply window as a clock: `24:00:00` when the customer writes,
 * ticking to zero, after which only a note can be saved.
 *
 * It is the third item on the subline — `+91 … · 21:04:33` — rather than a
 * badge of its own. The pill it used to live in cost about 60px of a row that
 * now has to hold two assignment controls, and set behind the phone number it
 * reads as the same sentence: who, and how long is left.
 *
 * The tick is a counter rather than a timestamp, so the digits are still
 * derived during render by `windowCountdown` and no state has to be written
 * from an effect body. Only this span re-renders once a second.
 */
function WindowCountdown({ lastInboundAt }: { lastInboundAt: string | null }) {
  const [, tick] = React.useState(0);

  React.useEffect(() => {
    const id = window.setInterval(() => tick((count) => count + 1), 1_000);

    return () => window.clearInterval(id);
  }, []);

  const left = windowCountdown(lastInboundAt);

  return (
    <span
      aria-label={
        left
          ? "Time left in the 24-hour reply window"
          : "The 24-hour reply window has closed"
      }
      className={cn(
        "shrink-0 tabular-nums",
        left ? "text-muted-foreground" : "text-muted-foreground/70",
      )}
      role="timer"
      title={
        left
          ? "Replies stay open until this reaches zero."
          : "WhatsApp only allows a reply after the customer writes again."
      }
    >
      {left ?? "window closed"}
    </span>
  );
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "Try again.";
}

/**
 * A pill select with its own chevron. `appearance-none` is what makes the
 * control match the chips around it instead of the OS widget, and the chevron
 * is a sibling because a `select` cannot hold one.
 */
function Field({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-flex min-w-0 items-center">
      {children}
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 size-3 text-muted-foreground opacity-70"
      />
    </span>
  );
}

