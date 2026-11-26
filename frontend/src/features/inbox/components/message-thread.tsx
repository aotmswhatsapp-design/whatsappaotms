"use client";

import * as React from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  Clock,
  CornerUpLeft,
  Inbox,
  LayoutTemplate,
  Loader2,
  MoreHorizontal,
  SmilePlus,
  StickyNote,
  Trash2,
} from "lucide-react";

import {
  BotCardBody,
  isInteractive,
} from "@/components/workspace/bot-card-preview";
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
  hideMessage,
  removeConversation,
  resumeAi,
  sendReaction,
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
  messageSnippet,
  windowCountdown,
} from "../format";
import { MessageContents, MessageLabel, MessageMedia } from "./message-media";

type Entry =
  | { kind: "message"; at: string; message: InboxMessage }
  | { kind: "note"; at: string; note: InboxNote };

/** One emoji on one message, tallied across both directions. */
interface ReactionTally {
  emoji: string;
  count: number;
  /** True when AOTMS sent it, which is what makes the chip removable. */
  mine: boolean;
}

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
  onReaction,
  onNote,
  onDeleted,
  onMessageHidden,
}: {
  thread: ThreadPayload | null;
  agents: InboxAgent[];
  loading: boolean;
  onBack: () => void;
  onChanged: (conversation: Conversation) => void;
  onMessage: (message: InboxMessage) => void;
  /** A reaction replaced or removed; null means nothing is left to show. */
  onReaction: (targetId: string, message: InboxMessage | null) => void;
  onNote: (note: InboxNote) => void;
  onDeleted: () => void;
  /** The bubble is gone from this inbox; the customer still has the message. */
  onMessageHidden: (messageId: string) => void;
}) {
  const toast = useToast();
  const scroller = React.useRef<HTMLDivElement>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [aiBusy, setAiBusy] = React.useState(false);
  /**
   * The pause a resume just cleared, as `conversationId:aiPausedAt`. A poll
   * that read the thread before the POST landed would otherwise put the pill
   * back, so the stamp itself is remembered rather than its absence — a new
   * pause writes a new stamp and the pill returns on its own.
   */
  const [clearedPause, setClearedPause] = React.useState<string | null>(null);
  const [quoted, setQuoted] = React.useState<InboxMessage | null>(null);

  const entries = React.useMemo<Entry[]>(() => {
    if (!thread) return [];

    return [
      // A reaction is drawn as a chip on the message it names, never as a
      // bubble of its own: an emoji with a timestamp reads as a message that
      // was said, and nothing was.
      ...thread.messages
        .filter((message) => message.kind !== "REACTION")
        .map((message) => ({
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

  /** Every message by row id, so a quote can be looked up while rendering. */
  const byId = React.useMemo(() => {
    const index = new Map<string, InboxMessage>();

    for (const message of thread?.messages ?? []) index.set(message.id, message);

    return index;
  }, [thread]);

  /**
   * Reactions tallied per target message. Meta keeps one reaction per sender
   * per message, so the customer's chip and ours can share an emoji, and the
   * count is what tells them apart in the bubble.
   */
  const reactions = React.useMemo(() => {
    const tallies = new Map<string, Map<string, ReactionTally>>();

    for (const message of thread?.messages ?? []) {
      if (message.kind !== "REACTION" || !message.body || !message.quotedMessageId) {
        continue;
      }

      const perTarget =
        tallies.get(message.quotedMessageId) ?? new Map<string, ReactionTally>();
      const tally = perTarget.get(message.body) ?? {
        emoji: message.body,
        count: 0,
        mine: false,
      };

      tally.count += 1;
      if (message.direction === "OUTBOUND") tally.mine = true;

      perTarget.set(message.body, tally);
      tallies.set(message.quotedMessageId, perTarget);
    }

    return new Map(
      [...tallies].map(([id, rows]) => [id, [...rows.values()] as ReactionTally[]]),
    );
  }, [thread]);

  // A quote survives a poll but not a change of conversation: the message it
  // names is no longer in the thread, so it is dropped on lookup rather than
  // cleared from an effect.
  const activeQuote = quoted && byId.has(quoted.id) ? quoted : null;

  const count = entries.length;

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

  // The pill is hidden for the one pause this session cleared, whether that
  // clearing has reached the server's own read yet or not.
  const aiPaused =
    conversation.aiPausedAt !== null &&
    `${conversation.id}:${conversation.aiPausedAt}` !== clearedPause;

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

  /**
   * Hands the thread back to the agent. The pause itself arrives on its own —
   * the server sets it on every human text send — and this is the only way to
   * clear it.
   */
  async function resumeAgent(): Promise<void> {
    if (!thread || aiBusy) return;

    setAiBusy(true);

    try {
      await resumeAi(thread.conversation.id);

      // Not `onChanged`: a poll can land during the request, and replacing the
      // whole conversation with the click-time object would drag a newer
      // status or assignee back. This hides the pill now; the next poll
      // confirms it with the server's own answer.
      setClearedPause(
        `${thread.conversation.id}:${thread.conversation.aiPausedAt}`,
      );

      toast.push({
        title: "The agent answers again",
        description:
          "The next message from this customer gets a reply from your material.",
        tone: "success",
      });
    } catch (error) {
      toast.push({
        title: "Could not resume the agent",
        description: errorText(error),
        tone: "error",
      });
    } finally {
      setAiBusy(false);
    }
  }

  /**
   * One emoji, or none. An empty emoji is the removal Meta understands, and
   * the handler above is told what is left so the chip can disappear without
   * waiting for the next poll.
   */
  async function react(target: InboxMessage, emoji: string): Promise<void> {
    if (!thread) return;

    try {
      const result = await sendReaction(thread.conversation.id, target.id, emoji);
      onReaction(target.id, result.message);
    } catch (error) {
      toast.push({
        title: "Could not react",
        description: errorText(error),
        tone: "error",
      });
    }
  }

  /**
   * Hides one bubble. A local tombstone, not a recall: Meta has no way to take
   * back a message the customer already received, so the question says exactly
   * that before anything is hidden.
   */
  async function hide(target: InboxMessage): Promise<void> {
    if (!thread) return;

    const sure = window.confirm(
      "Hide this message from the inbox?\n\nIt stays on the customer's phone — WhatsApp has no way to delete a message once it has been delivered.",
    );

    if (!sure) return;

    try {
      await hideMessage(target.id);
      onMessageHidden(target.id);
      toast.push({ title: "Message hidden", tone: "success" });
    } catch (error) {
      toast.push({
        title: "Could not hide the message",
        description: errorText(error),
        tone: "error",
      });
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
              {/* Who answers here. The thread binds to one agent on its first
                  inbound message and keeps it, so the header names that agent
                  rather than the number's. While AI is paused the controls say
                  so, and naming an agent that is not answering would misread. */}
              {!aiPaused && conversation.agent ? (
                <>
                  <span aria-hidden="true" className="shrink-0 text-muted-foreground/50">
                    ·
                  </span>
                  <span
                    className="flex min-w-0 items-center gap-1"
                    title={`${conversation.agent.name} answers this conversation`}
                  >
                    <Bot aria-hidden="true" className="size-3 shrink-0" />
                    <span className="truncate">{conversation.agent.name}</span>
                  </span>
                </>
              ) : null}
            </p>
          </div>

          {/* Assignment shares this row from 640px up, immediately before the
              menu — this is the only line the header has now. Below that they
              leave: two native selects carry a min-content width equal to
              their longest option, so at 390px keeping them would squeeze the
              name to a couple of characters. On a phone the same two controls
              are menu items instead. */}
          <div className="hidden min-w-0 items-center gap-1.5 sm:flex">
            {aiPaused ? (
              <button
                type="button"
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-warning/40 px-2.5 text-[11px] font-medium text-warning outline-none transition-colors hover:bg-warning/10 focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:opacity-40"
                disabled={aiBusy}
                onClick={() => void resumeAgent()}
                title={pauseReason(conversation.aiPauseReason)}
              >
                <Bot aria-hidden="true" className="size-3.5" />
                {aiBusy ? "Resuming…" : "AI paused · resume"}
              </button>
            ) : null}

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
                {aiPaused ? (
                  <DropdownMenuItem onSelect={() => void resumeAgent()}>
                    <Bot aria-hidden="true" />
                    Resume the AI agent
                  </DropdownMenuItem>
                ) : null}
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
                  <Bubble
                    message={entry.message}
                    peer={
                      conversation.contact.name ??
                      displayPhone(conversation.contact.waId)
                    }
                    quoted={
                      (entry.message.quotedMessageId
                        ? byId.get(entry.message.quotedMessageId)
                        : null) ?? null
                    }
                    reactions={reactions.get(entry.message.id) ?? []}
                    onQuote={setQuoted}
                    onReact={(target, emoji) => void react(target, emoji)}
                    onHide={(target) => void hide(target)}
                  />
                ) : (
                  <NoteCard note={entry.note} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <Composer
        conversation={conversation}
        quoted={activeQuote}
        onClearQuote={() => setQuoted(null)}
        onSent={onMessage}
        onNoted={onNote}
      />
    </div>
  );
}

function Bubble({
  message,
  peer,
  quoted,
  reactions,
  onQuote,
  onReact,
  onHide,
}: {
  message: InboxMessage;
  /** Who the customer is, for the name above a quoted message. */
  peer: string;
  quoted: InboxMessage | null;
  reactions: ReactionTally[];
  onQuote: (message: InboxMessage) => void;
  onReact: (message: InboxMessage, emoji: string) => void;
  onHide: (message: InboxMessage) => void;
}) {
  const outbound = message.direction === "OUTBOUND";
  // A card arrives with its picture and its choices only when it was sent as
  // an interactive message. A card with no buttons, or with more rows than a
  // list holds, went out as plain text — `body` already holds that text, so
  // drawing the card too would show the customer a message they never got.
  const card = message.card && isInteractive(message.card) ? message.card : null;

  return (
    <div
      className={cn(
        "group/bubble flex flex-col gap-0.5",
        outbound ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "flex w-full items-center gap-1",
          outbound ? "justify-end" : "justify-start",
        )}
      >
        {outbound ? null : (
          <BubbleActions
            message={message}
            onHide={onHide}
            onQuote={onQuote}
            onReact={onReact}
          />
        )}

        <div
          className={cn(
            // WhatsApp draws the sender in green and the customer in white, with
            // the ink staying dark on both — white type on #D9FDD3 is 1.2:1.
            // The corner nearest the sender's edge is squarer, which reads as a
            // tail without drawing an actual one.
            "min-w-0 max-w-[85%] rounded-xl px-3 py-2 text-[13.5px] shadow-xs sm:max-w-[75%]",
            outbound
              ? "rounded-br-sm bg-brand-soft text-foreground"
              : "rounded-bl-sm border border-border bg-card text-foreground",
          )}
        >
          {/* The message this one answers, above everything else so a reply
              reads as "this, then that". */}
          {quoted ? (
            <QuoteBlock message={quoted} outbound={outbound} peer={peer} />
          ) : null}

          {message.media ? (
            <div className="mb-1.5">
              <MessageMedia message={message} />
            </div>
          ) : null}

          {/* A location and a contact card carry their own contents; the label
              is only the fallback for a payload that did not arrive. Their
              `body` repeats the first line of those contents (a pin's name, a
              card's names), so it is the payload or the body, never both. */}
          <MessageContents message={message} />
          {message.payload || card ? null : <MessageLabel kind={message.kind} />}

          {/* The card as it was sent: the picture header, the header line, the
              information and the pills under it. `BotCardBody` is the same
              markup `BotCardPreview` draws in the builder and the send panel,
              so one card reads the same in all three places. The bubble's own
              time and ticks stay below it — the card carries no timestamp. */}
          {card ? (
            <div className="mb-1.5">
              <BotCardBody card={card} className="w-[17rem] max-w-full" />
            </div>
          ) : null}

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

          {message.body && !message.payload && !card ? (
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
            {message.agentId ? (
              <span
                className="mr-0.5 rounded-sm border border-brand/35 px-1 text-[9px] leading-4 font-semibold tracking-wide text-brand uppercase"
                title="The AI agent wrote this, not a person"
              >
                AI
              </span>
            ) : null}
            <time dateTime={message.createdAt}>{clockTime(message.createdAt)}</time>
            {outbound ? <Tick status={message.status} /> : null}
          </div>
        </div>

        {outbound ? (
          <BubbleActions
            message={message}
            onHide={onHide}
            onQuote={onQuote}
            onReact={onReact}
          />
        ) : null}
      </div>

      {reactions.length > 0 ? (
        <div className="-mt-1 flex flex-wrap gap-1 px-1">
          {reactions.map((row) => (
            <button
              key={row.emoji}
              type="button"
              aria-label={
                row.mine
                  ? `Remove your ${row.emoji} reaction`
                  : `React with ${row.emoji}`
              }
              title={row.mine ? "Tap to remove your reaction" : undefined}
              className={cn(
                "inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[11px] leading-none transition-colors",
                row.mine
                  ? "border-brand/50 bg-brand-soft"
                  : "border-border bg-card hover:bg-accent",
              )}
              onClick={() => onReact(message, row.mine ? "" : row.emoji)}
            >
              <span aria-hidden="true">{row.emoji}</span>
              {row.count > 1 ? (
                <span className="tabular-nums text-[10px] text-muted-foreground">
                  {row.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The emojis offered in one tap; anything else is still a message away. */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🙏", "✅", "🎉"];

/**
 * Reply and react, on the edge of the bubble away from its tail.
 *
 * Hidden until the bubble is hovered, or until something inside it takes
 * focus, so a quiet thread stays quiet. `pointer-events-none` while hidden is
 * what keeps an invisible button from swallowing a tap meant for the bubble;
 * keyboard focus still reaches them, and `group-focus-within` is what makes
 * them visible once it does.
 */
function BubbleActions({
  message,
  onHide,
  onQuote,
  onReact,
}: {
  message: InboxMessage;
  onHide: (message: InboxMessage) => void;
  onQuote: (message: InboxMessage) => void;
  onReact: (message: InboxMessage, emoji: string) => void;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5 transition-opacity",
        "pointer-events-none opacity-0",
        "group-hover/bubble:pointer-events-auto group-hover/bubble:opacity-100",
        "group-focus-within/bubble:pointer-events-auto group-focus-within/bubble:opacity-100",
      )}
    >
      <button
        type="button"
        aria-label="Quote this message in a reply"
        title="Reply"
        className="grid size-7 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => onQuote(message)}
      >
        <CornerUpLeft aria-hidden="true" className="size-3.5" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="React to this message"
            title="React"
            className="grid size-7 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <SmilePlus aria-hidden="true" className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="flex w-auto gap-0.5 p-1"
          data-theme="inbox"
          side="top"
        >
          {QUICK_REACTIONS.map((emoji) => (
            <DropdownMenuItem
              key={emoji}
              aria-label={`React with ${emoji}`}
              className="grid size-8 place-items-center rounded-md p-0 text-base leading-none"
              onSelect={() => onReact(message, emoji)}
            >
              <span aria-hidden="true">{emoji}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The last action, and the only destructive one: it hides the bubble
          from this inbox and leaves the customer's copy alone. */}
      <button
        type="button"
        aria-label="Hide this message from the inbox"
        title="Hide from the inbox"
        className="grid size-7 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => onHide(message)}
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

/** The message a reply answers, drawn the way WhatsApp draws it. */
function QuoteBlock({
  message,
  outbound,
  peer,
}: {
  message: InboxMessage;
  outbound: boolean;
  peer: string;
}) {
  return (
    <div
      className={cn(
        "mb-1.5 rounded-md border-l-2 px-2 py-1",
        outbound
          ? "border-brand/60 bg-card/60"
          : "border-brand/50 bg-secondary/60",
      )}
    >
      <p className="text-[10px] font-semibold text-brand">
        {message.direction === "OUTBOUND" ? "You" : peer}
      </p>
      <p className="line-clamp-2 text-[11.5px] leading-snug break-words text-muted-foreground">
        {messageSnippet(message)}
      </p>
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
 * Why the agent stopped, in a sentence. The column holds one word — `human`
 * for a teammate's reply, `manual` for an API pause, `handoff` when the agent
 * asked for one, `unavailable` when it could not be reached — and a tooltip
 * should not be a database value.
 */
function pauseReason(reason: string | null): string {
  switch (reason) {
    case "human":
      return "A teammate replied here, so the agent stepped back.";
    case "manual":
      return "Turned off from this thread.";
    case "handoff":
      return "The agent asked for a person on this thread.";
    case "no-context":
      return "The material had no answer, so the agent asked for a person.";
    case "unavailable":
      return "The AI service failed on this message, so the agent asked for a person.";
    default:
      return "The agent is not answering this thread.";
  }
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

