"use client";

import * as React from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  Inbox,
  Loader2,
  StickyNote,
  Trash2,
} from "lucide-react";

import { EmptyState } from "@/components/workspace/empty-state";
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
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 sm:gap-3 sm:px-5">
        <button
          type="button"
          aria-label="Back to conversations"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
        </button>

        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand ring-1 ring-brand/10">
          {initials(conversation.contact.name, conversation.contact.waId)}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] leading-tight font-semibold text-foreground">
            {conversation.contact.name ?? displayPhone(conversation.contact.waId)}
          </p>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            {displayPhone(conversation.contact.phone ?? conversation.contact.waId)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "hidden items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium sm:inline-flex",
              conversation.windowOpen
                ? "bg-lime-soft text-lime"
                : "bg-secondary text-muted-foreground",
            )}
            title={
              conversation.windowOpen
                ? "You can reply until the 24-hour window closes."
                : "WhatsApp only allows a reply after the customer writes again."
            }
          >
            <Clock aria-hidden="true" className="size-3.5" />
            {conversation.windowOpen ? (left ?? "Open") : "Window closed"}
          </span>

          <select
            aria-label="Conversation status"
            className="h-9 rounded-lg border border-transparent bg-secondary/70 px-2.5 text-[13px] font-medium text-foreground outline-none transition-colors hover:bg-secondary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
            value={conversation.status}
            onChange={(event) =>
              void patch({ status: event.target.value as ConversationStatus })
            }
          >
            <option value="OPEN">Open</option>
            <option value="PENDING">Pending</option>
            <option value="CLOSED">Closed</option>
          </select>

          <select
            aria-label="Assigned agent"
            className="h-9 max-w-40 rounded-lg border border-transparent bg-secondary/70 px-2.5 text-[13px] font-medium text-foreground outline-none transition-colors hover:bg-secondary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
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
            !agents.some((agent) => agent.userId === conversation.assignedTo?.id) ? (
              <option value={conversation.assignedTo.id}>
                {conversation.assignedTo.name ?? conversation.assignedTo.email}
              </option>
            ) : null}
          </select>

          <button
            type="button"
            aria-label="Delete conversation"
            className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
            disabled={deleting}
            onClick={() => void remove()}
          >
            {deleting ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>
      </header>

      <div
        ref={scroller}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-background px-4 py-5 sm:px-6"
      >
        {entries.length === 0 ? (
          <p className="py-10 text-center text-[14px] text-muted-foreground">
            Nothing in this thread yet.
          </p>
        ) : null}

        {entries.map((entry, index) => {
          const previous = index > 0 ? entries[index - 1].at : null;
          const newDay = previous === null || dayKey(previous) !== dayKey(entry.at);

          return (
            <React.Fragment key={`${entry.kind}-${entry.kind === "message" ? entry.message.id : entry.note.id}`}>
              {newDay ? (
                <p className="py-2.5 text-center text-[12px] font-medium text-muted-foreground">
                  {dayLabel(entry.at)}
                </p>
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

