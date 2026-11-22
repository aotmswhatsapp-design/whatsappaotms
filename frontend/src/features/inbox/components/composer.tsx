"use client";

import * as React from "react";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Paperclip,
  SendHorizontal,
  UserRound,
  X,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  ApiError,
  addNote,
  sendMedia,
  sendText,
  showTyping,
  type Conversation,
  type InboxMessage,
  type InboxNote,
} from "../api";
import { messageSnippet } from "../format";
import { ModeSwitcher, type ComposerMode } from "./mode-switcher";
import { ContactPanel, LocationPanel } from "./share-panels";
import { TemplatePanel } from "./template-panel";

/** Mirrors the API's cap, so an oversized file fails before it is uploaded. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Meta drops the typing bubble on its own after 25 seconds, so a long draft
 * re-arms it well inside that window without a call on every keystroke.
 */
const TYPING_EVERY_MS = 20_000;

/** The two shapes the attach menu offers. Anything else is still accepted by
 * WhatsApp, but a picker that cannot describe a file is worse than two honest
 * ones. */
const PHOTOS = "image/*,video/*";
const DOCUMENTS =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,application/pdf";

type Mode = ComposerMode;

/**
 * The thread's input. A reply travels to WhatsApp and is disabled once the
 * 24-hour window closes; a note never leaves the workspace, so it stays
 * available; a template is the one message WhatsApp allows past the window.
 */
export function Composer({
  conversation,
  quoted,
  onClearQuote,
  onSent,
  onNoted,
}: {
  conversation: Conversation;
  /** The message the next reply answers, if the agent picked one. */
  quoted: InboxMessage | null;
  onClearQuote: () => void;
  onSent: (message: InboxMessage) => void;
  onNoted: (note: InboxNote) => void;
}) {
  const area = React.useRef<HTMLTextAreaElement>(null);
  const picker = React.useRef<HTMLInputElement>(null);

  /** The last thread we told Meta we were typing in, and when. */
  const announced = React.useRef<{ id: string; at: number }>({ id: "", at: 0 });

  const [mode, setMode] = React.useState<Mode>("reply");
  const [panel, setPanel] = React.useState<"location" | "contact" | null>(null);
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const locked = !conversation.windowOpen;
  const active = mode === "note" || !locked;

  function failure(cause: unknown): string {
    if (cause instanceof ApiError) {
      if (cause.code === "WINDOW_CLOSED") {
        return "The 24-hour window closed. Send a note, or wait for the customer to write again.";
      }

      return cause.message;
    }

    return "Could not send that. Try again.";
  }

  /**
   * Only fires once the agent has actually typed something: opening a thread is
   * not a promise to answer, and Meta asks that the bubble never imply one.
   * Notes and a closed window are excluded for the same reason — neither can
   * end in a reply. A refusal is silent; it is a courtesy, not a feature the
   * agent should be interrupted for.
   */
  function announceTyping(): void {
    if (mode !== "reply" || locked) return;

    const now = Date.now();
    const last = announced.current;

    if (last.id === conversation.id && now - last.at < TYPING_EVERY_MS) return;

    announced.current = { id: conversation.id, at: now };
    void showTyping(conversation.id).catch(() => undefined);
  }

  /** Sending dismisses the bubble on Meta's side; the next draft starts over. */
  function forgetTyping(): void {
    announced.current = { id: "", at: 0 };
  }

  async function submit(): Promise<void> {
    const body = text.trim();

    if (!body || sending) return;

    setSending(true);
    setError(null);

    try {
      if (mode === "note") {
        const { note } = await addNote(conversation.id, body);
        onNoted(note);
      } else {
        const { message } = await sendText(conversation.id, body, quoted?.id);
        onSent(message);
        onClearQuote();
        forgetTyping();
      }

      setText("");
      area.current?.focus();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setSending(false);
    }
  }

  async function attach(file: File): Promise<void> {
    if (sending) return;

    if (file.size > MAX_BYTES) {
      setError("Files are limited to 25 MB.");
      return;
    }

    setSending(true);
    setError(null);

    try {
      // The typed text becomes the caption, which is what WhatsApp shows.
      const { message } = await sendMedia(conversation.id, file, text, quoted?.id);
      onSent(message);
      onClearQuote();
      forgetTyping();
      setText("");
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setSending(false);
      if (picker.current) picker.current.value = "";
    }
  }

  function switchMode(next: Mode): void {
    setMode(next);
    setPanel(null);
    setError(null);

    // The template panel owns its own inputs; focusing the reply box here would
    // pull the caret into a field the agent cannot see.
    if (next !== "template") area.current?.focus();
  }

  /**
   * The two service messages that need more than a sentence. They replace the
   * typing bar rather than stacking above it, the way the template panel does:
   * a second composer over the first is a form, not a chat.
   */
  function openPanel(next: "location" | "contact"): void {
    setPanel(next);
    setError(null);
  }

  /**
   * One hidden input serves both menu items; the accept list is set per pick so
   * the OS dialog only shows what the chosen item promises.
   */
  function pick(accept: string): void {
    const input = picker.current;

    if (!input) return;

    input.accept = accept;
    input.click();
  }

  const rows = Math.min(6, Math.max(1, text.split("\n").length));

  return (
    <div className="shrink-0 border-t border-border bg-card px-3 pt-2 pb-1.5 sm:px-4">
      {mode === "template" ? (
        <TemplatePanel
          conversationId={conversation.id}
          locked={locked}
          mode={mode}
          onModeChange={switchMode}
          onSent={onSent}
        />
      ) : panel === "location" ? (
        <LocationPanel
          conversationId={conversation.id}
          locked={locked}
          onClose={() => setPanel(null)}
          onSent={onSent}
        />
      ) : panel === "contact" ? (
        <ContactPanel
          conversationId={conversation.id}
          locked={locked}
          onClose={() => setPanel(null)}
          onSent={onSent}
        />
      ) : (
        <>
          {/* The message a reply will be attached to. It sits over the bar
              rather than inside it, so a long quote cannot squeeze the field
              the agent is typing in. */}
          {mode === "reply" && quoted ? (
            <div className="mb-1.5 flex items-start gap-2 rounded-lg border-l-2 border-brand/60 bg-secondary/60 px-2 py-1">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold text-brand">
                  {quoted.direction === "OUTBOUND"
                    ? "Replying to your message"
                    : "Replying to the customer"}
                </p>
                <p className="line-clamp-1 text-[11px] text-muted-foreground">
                  {messageSnippet(quoted)}
                </p>
              </div>
              <button
                type="button"
                aria-label="Cancel the quote"
                className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                onClick={onClearQuote}
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </div>
          ) : null}

          {error ? (
            <p className="mb-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 text-[11.5px] leading-relaxed text-destructive">
              {error}
            </p>
          ) : null}

          {/* One bar. The reply/note switch used to sit above the field as its own
              row, which cost 34px of thread height to say something two small
              buttons can say from inside the bar. */}
          <div
            className={cn(
              "flex items-end gap-1.5 rounded-xl border bg-card p-1.5 transition-colors",
              mode === "note" ? "border-warning/40" : "border-border",
              active
                ? "focus-within:border-brand/40 focus-within:ring-[3px] focus-within:ring-brand/10"
                : "opacity-75",
            )}
          >
            <ModeSwitcher
              className="mb-1"
              locked={locked}
              mode={mode}
              onChange={switchMode}
            />

            {mode === "reply" ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Attach a file"
                      className="mb-1 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                      disabled={locked || sending}
                    >
                      <Paperclip aria-hidden="true" className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-56"
                    data-theme="inbox"
                    side="top"
                  >
                    <DropdownMenuItem onSelect={() => pick(PHOTOS)}>
                      <ImageIcon aria-hidden="true" />
                      Photo or video
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => pick(DOCUMENTS)}>
                      <FileText aria-hidden="true" />
                      Document
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => openPanel("location")}>
                      <MapPin aria-hidden="true" />
                      Location
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => openPanel("contact")}>
                      <UserRound aria-hidden="true" />
                      Contact card
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <input
                  ref={picker}
                  className="hidden"
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void attach(file);
                  }}
                />
              </>
            ) : null}

            <textarea
              ref={area}
              aria-label={mode === "note" ? "Internal note" : "Reply"}
              className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[12.5px] leading-relaxed outline-none placeholder:text-muted-foreground"
              disabled={!active || sending}
              placeholder={
                mode === "note"
                  ? "Write a note only your team sees…"
                  : locked
                    ? "The 24-hour window has closed."
                    : "Write a reply…"
              }
              rows={rows}
              value={text}
              onChange={(event) => {
                setText(event.target.value);

                if (event.target.value.trim().length > 0) announceTyping();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />

            <button
              type="button"
              aria-label={mode === "note" ? "Save note" : "Send reply"}
              className={cn(
                "mb-1 grid size-9 shrink-0 place-items-center rounded-full text-brand-foreground transition-[background-color,opacity] hover:opacity-90 disabled:opacity-40",
                mode === "note" ? "bg-warning" : "bg-brand",
              )}
              disabled={!active || sending || text.trim().length === 0}
              onClick={() => void submit()}
            >
              {sending ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <SendHorizontal aria-hidden="true" className="size-4" />
              )}
            </button>
          </div>

          <p className="mt-1 px-1 text-[10px] text-muted-foreground">
            {locked && mode === "reply"
              ? "Replies reopen when the customer writes again."
              : mode === "note"
                ? "Notes stay in this workspace and are never sent to the customer."
                : "Enter sends · Shift+Enter adds a line · files up to 25 MB"}
          </p>
        </>
      )}
    </div>
  );
}

