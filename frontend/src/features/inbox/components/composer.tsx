"use client";

import * as React from "react";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  SendHorizontal,
  StickyNote,
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
  type Conversation,
  type InboxMessage,
  type InboxNote,
} from "../api";

/** Mirrors the API's cap, so an oversized file fails before it is uploaded. */
const MAX_BYTES = 25 * 1024 * 1024;

/** The two shapes the attach menu offers. Anything else is still accepted by
 * WhatsApp, but a picker that cannot describe a file is worse than two honest
 * ones. */
const PHOTOS = "image/*,video/*";
const DOCUMENTS = ".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,application/pdf";

type Mode = "reply" | "note";

/**
 * The thread's input. A reply travels to WhatsApp and is disabled once the
 * 24-hour window closes; a note never leaves the workspace, so it stays
 * available.
 */
export function Composer({
  conversation,
  onSent,
  onNoted,
}: {
  conversation: Conversation;
  onSent: (message: InboxMessage) => void;
  onNoted: (note: InboxNote) => void;
}) {
  const area = React.useRef<HTMLTextAreaElement>(null);
  const picker = React.useRef<HTMLInputElement>(null);

  const [mode, setMode] = React.useState<Mode>("reply");
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
        const { message } = await sendText(conversation.id, body);
        onSent(message);
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
      const { message } = await sendMedia(conversation.id, file, text);
      onSent(message);
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
    setError(null);
    area.current?.focus();
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
    <div className="shrink-0 border-t border-border bg-card px-3 pt-2.5 pb-2 sm:px-4">
      {error ? (
        <p className="mb-2 rounded-lg bg-destructive/10 px-3 py-1.5 text-[13px] leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}

      {/* One bar. The reply/note switch used to sit above the field as its own
          row, which cost 34px of thread height to say something two small
          buttons can say from inside the bar. */}
      <div
        className={cn(
          "flex items-end gap-1 rounded-2xl border bg-card p-1 transition-colors",
          mode === "note" ? "border-warning/40" : "border-border",
          active
            ? "focus-within:border-brand/40 focus-within:ring-[3px] focus-within:ring-brand/10"
            : "opacity-75",
        )}
      >
        <div
          role="group"
          aria-label="Message type"
          className="mb-0.5 flex shrink-0 items-center gap-0.5 rounded-full bg-secondary/80 p-0.5"
        >
          <ModeButton
            active={mode === "reply"}
            disabled={locked}
            onClick={() => switchMode("reply")}
            icon={<SendHorizontal aria-hidden="true" className="size-3.5" />}
            label="Reply"
            title={
              locked ? "The customer has not written for 24 hours." : undefined
            }
          />
          <ModeButton
            active={mode === "note"}
            onClick={() => switchMode("note")}
            icon={<StickyNote aria-hidden="true" className="size-3.5" />}
            label="Note"
          />
        </div>

        {mode === "reply" ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Attach a file"
                  className="mb-0.5 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                  disabled={locked || sending}
                >
                  <Paperclip aria-hidden="true" className="size-[17px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52" side="top">
                <DropdownMenuItem onSelect={() => pick(PHOTOS)}>
                  <ImageIcon aria-hidden="true" />
                  Photo or video
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => pick(DOCUMENTS)}>
                  <FileText aria-hidden="true" />
                  Document
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
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1.5 py-2 text-[14.5px] leading-relaxed outline-none placeholder:text-muted-foreground"
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
          onChange={(event) => setText(event.target.value)}
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
            "mb-0.5 grid size-9 shrink-0 place-items-center rounded-full text-brand-foreground transition-[background-color,opacity] hover:opacity-90 disabled:opacity-40",
            mode === "note" ? "bg-warning" : "bg-brand",
          )}
          disabled={!active || sending || text.trim().length === 0}
          onClick={() => void submit()}
        >
          {sending ? (
            <Loader2 aria-hidden="true" className="size-[17px] animate-spin" />
          ) : (
            <SendHorizontal aria-hidden="true" className="size-[17px]" />
          )}
        </button>
      </div>

      <p className="mt-1.5 px-1 text-[11.5px] text-muted-foreground">
        {locked && mode === "reply"
          ? "Replies reopen when the customer writes again."
          : mode === "note"
            ? "Notes stay in this workspace and are never sent to the customer."
            : "Enter sends · Shift+Enter adds a line · files up to 25 MB"}
      </p>
    </div>
  );
}

function ModeButton({
  active,
  label,
  icon,
  onClick,
  disabled,
  title,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-2 text-[12.5px] font-medium transition-colors sm:px-2.5",
        active
          ? "bg-card text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-40",
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {icon}
      {/* The icon alone carries the control below `sm`; the label stays in the
          tree so the button keeps a real name for screen readers. */}
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
}
