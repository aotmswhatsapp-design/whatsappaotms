"use client";

import * as React from "react";
import { Loader2, Paperclip, SendHorizontal, StickyNote } from "lucide-react";

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

  const rows = Math.min(6, Math.max(1, text.split("\n").length));

  return (
    <div className="border-t border-border p-3">
      <div className="mb-2 flex items-center gap-1 rounded-lg bg-secondary p-1">
        <ModeButton
          active={mode === "reply"}
          disabled={locked}
          onClick={() => switchMode("reply")}
          icon={<SendHorizontal aria-hidden="true" className="size-3.5" />}
          label="Reply"
          title={locked ? "The customer has not written for 24 hours." : undefined}
        />
        <ModeButton
          active={mode === "note"}
          onClick={() => switchMode("note")}
          icon={<StickyNote aria-hidden="true" className="size-3.5" />}
          label="Internal note"
        />
      </div>

      {error ? (
        <p className="mb-2 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      <div
        className={cn(
          "flex items-end gap-2 rounded-xl border bg-card px-3 py-2",
          mode === "note" ? "border-warning/40" : "border-border",
          active ? "focus-within:border-brand/40 focus-within:ring-[3px] focus-within:ring-brand/10" : "opacity-70",
        )}
      >
        {mode === "reply" ? (
          <>
            <button
              type="button"
              aria-label="Attach a file"
              className="mb-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              disabled={locked || sending}
              onClick={() => picker.current?.click()}
            >
              <Paperclip aria-hidden="true" className="size-4" />
            </button>
            <input
              ref={picker}
              accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
              className="hidden"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void attach(file);
              }}
            />
          </>
        ) : (
          <StickyNote
            aria-hidden="true"
            className="mb-2 size-4 shrink-0 text-warning"
          />
        )}

        <textarea
          ref={area}
          aria-label={mode === "note" ? "Internal note" : "Reply"}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
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
            "mb-1 grid size-9 shrink-0 place-items-center rounded-lg text-brand-foreground transition-colors",
            mode === "note" ? "bg-warning" : "bg-brand",
            "hover:opacity-90 disabled:opacity-40",
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

      <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
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
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors",
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
      {label}
    </button>
  );
}
