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
  windowLeft,
} from "../format";
import { MessageMedia } from "./message-media";

type Entry =
  | { kind: "message"; at: string; message: InboxMessage }
  | { kind: "note"; at: string; note: InboxNote };

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
  const left = windowLeft(conversation.lastInboundAt);

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
      {/* Two fixed rows: who you are talking to, then the two assignment
          controls. Pinned rather than wrapped — a header that re-flows as the
          resizer moves is what made this pane feel unstable — and sized to
          the queue's 110px block so the hairline runs straight across the
          divider. */}
      <header className="shrink-0 border-b border-border bg-card">
        <div className="flex h-16 items-center gap-3 pr-2 pl-3 sm:pl-4">
          <button
            type="button"
            aria-label="Back to conversations"
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" className="size-[18px]" />
          </button>

          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand">
            {initials(conversation.contact.name, conversation.contact.waId)}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] leading-tight font-semibold text-foreground">
              {conversation.contact.name ??
                displayPhone(conversation.contact.waId)}
            </p>
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
              {/* An unnamed contact already uses the number as the title, so
                  repeating it here would just say the same thing twice. */}
              {conversation.contact.name ? (
                <>
                  <span className="truncate">
                    {displayPhone(
                      conversation.contact.phone ?? conversation.contact.waId,
                    )}
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-border">
                    ·
                  </span>
                </>
              ) : null}
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 font-medium",
                  conversation.windowOpen ? "text-lime" : "text-muted-foreground",
                )}
                title={
                  conversation.windowOpen
                    ? "You can reply until the 24-hour window closes."
                    : "WhatsApp only allows a reply after the customer writes again."
                }
              >
                <Clock aria-hidden="true" className="size-3" />
                {conversation.windowOpen ? (left ?? "Open") : "Window closed"}
              </span>
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Conversation actions"
                className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-40"
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <MoreHorizontal aria-hidden="true" className="size-[18px]" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
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

        <div className="flex items-center gap-1.5 px-3 pb-2.5 sm:px-4">
          <Field>
            <select
              aria-label="Conversation status"
              className={cn(
                "h-9 appearance-none rounded-full border pr-8 pl-3 text-[12.5px] font-medium outline-none transition-colors",
                "focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-brand/10",
                conversation.status === "PENDING"
                  ? "border-transparent bg-warning-soft text-warning"
                  : conversation.status === "CLOSED"
                    ? "border-transparent bg-secondary text-muted-foreground"
                    : "border-border bg-card text-foreground",
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
                "h-9 max-w-40 appearance-none truncate rounded-full border pr-8 pl-3 text-[12.5px] font-medium outline-none transition-colors sm:max-w-52",
                "focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-brand/10",
                conversation.assignedTo
                  ? "border-border bg-card text-foreground"
                  : "border-transparent bg-secondary text-muted-foreground",
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
      </header>

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-5 sm:px-6"
      >
        {/* A readable column inside the pane: at 1400px the thread is wider
            than any comfortable line length, and bubbles hugging opposite
            edges turn into a tennis match. */}
        <div className="mx-auto w-full max-w-[46rem] space-y-2.5">
          {entries.length === 0 ? (
            <p className="py-10 text-center text-[14px] text-muted-foreground">
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
                  <div className="flex justify-center py-2.5">
                    <span className="rounded-full border border-border bg-card px-3 py-1 text-[11.5px] font-medium text-muted-foreground shadow-xs">
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
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] shadow-xs sm:max-w-[75%]",
          outbound
            ? "rounded-br-md bg-brand text-brand-foreground"
            : "rounded-bl-md border border-border bg-card text-foreground",
        )}
      >
        {message.media ? (
          <div className="mb-1.5">
            <MessageMedia message={message} />
          </div>
        ) : null}

        {message.body ? (
          <p className="break-words whitespace-pre-wrap leading-relaxed">
            {message.body}
          </p>
        ) : null}

        {message.errorReason ? (
          <p
            className={cn(
              "mt-1.5 text-[12.5px]",
              outbound ? "text-brand-foreground/90" : "text-destructive",
            )}
          >
            {message.errorReason}
          </p>
        ) : null}

        <div
          className={cn(
            "mt-1.5 flex items-center justify-end gap-1 text-[11px]",
            outbound ? "text-brand-foreground/70" : "text-muted-foreground",
          )}
        >
          <time dateTime={message.createdAt}>{clockTime(message.createdAt)}</time>
          {outbound ? <Tick status={message.status} /> : null}
        </div>
      </div>
    </div>
  );
}

function Tick({ status }: { status: InboxMessage["status"] }) {
  if (status === "FAILED") {
    return <CircleAlert aria-label="Not delivered" className="size-3.5" />;
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
      className={cn("size-3.5", read && "text-blue-soft")}
    />
  );
}

function NoteCard({ note }: { note: InboxNote }) {
  return (
    <div className="flex justify-center">
      <div className="max-w-[85%] rounded-xl border border-warning/30 bg-warning-soft px-4 py-2.5 sm:max-w-[75%]">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-warning uppercase">
          <StickyNote aria-hidden="true" className="size-3.5" />
          Internal note
          <span className="font-medium tracking-normal normal-case">
            · {note.author.name ?? "A teammate"}
          </span>
        </p>
        <p className="mt-1.5 text-[14px] break-words whitespace-pre-wrap text-foreground">
          {note.body}
        </p>
        <p className="mt-1 text-right text-[11px] text-warning/80">
          {clockTime(note.createdAt)}
        </p>
      </div>
    </div>
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
        className="pointer-events-none absolute right-2.5 size-3.5 opacity-60"
      />
    </span>
  );
}

