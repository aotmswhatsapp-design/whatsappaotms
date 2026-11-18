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
    <div className="border-t border-border p-4">
      <div className="mb-2 flex items-center gap-1">
        <ModeButton
          active={mode === "reply"}
          disabled={locked}
          onClick={() => switchMode("reply")}
          icon={<SendHorizontal aria-hidden="true" className="size-4" />}
          label="Reply"
          title={locked ? "The customer has not written for 24 hours." : undefined}
        />
        <ModeButton
          active={mode === "note"}
          onClick={() => switchMode("note")}
          icon={<StickyNote aria-hidden="true" className="size-4" />}
          label="Internal note"
        />
      </div>

      {error ? (
        <p className="mb-2 rounded-md bg-destructive/10 px-3 py-2 text-[14px] text-destructive">
          {error}
        </p>
      ) : null}

      <div
        className={cn(
          "flex items-end gap-1.5 rounded-xl border bg-card p-2",
          mode === "note" ? "border-warning/40" : "border-border",
          active ? "focus-within:border-brand/40 focus-within:ring-[3px] focus-within:ring-brand/10" : "opacity-70",
        )}
      >
        {mode === "reply" ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Attach a file"
                  className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                  disabled={locked || sending}
                >
                  <Paperclip aria-hidden="true" className="size-[18px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
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
        ) : (
          <StickyNote
            aria-hidden="true"
            className="mb-3 ml-2 size-[18px] shrink-0 text-warning"
          />
        )}

        <textarea
          ref={area}
          aria-label={mode === "note" ? "Internal note" : "Reply"}
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
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
            "grid size-10 shrink-0 place-items-center rounded-lg text-brand-foreground transition-colors",
            mode === "note" ? "bg-warning" : "bg-brand",
            "hover:opacity-90 disabled:opacity-40",
          )}
          disabled={!active || sending || text.trim().length === 0}
          onClick={() => void submit()}
        >
          {sending ? (
            <Loader2 aria-hidden="true" className="size-[18px] animate-spin" />
          ) : (
            <SendHorizontal aria-hidden="true" className="size-[18px]" />
          )}
        </button>
      </div>

      <p className="mt-2 px-1 text-[12px] text-muted-foreground">
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
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
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
