"use client";

import * as React from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Film,
  Loader2,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import type { CardFile, CardFileKind } from "@/lib/bots/card";
import {
  MAX_CARD_FILES,
  MAX_CARD_FILE_BYTES,
  MAX_CARD_VIDEO_BYTES,
} from "@/lib/bots/limits";
import { cn } from "@/lib/utils";
import {
  ApiError,
  fetchCardMedia,
  removeCardMedia,
  uploadCardMedia,
  type CardFileUpload,
} from "../api";

/**
 * The Files field: a PDF, a Word or Excel file, or a video, handed over with
 * the card.
 *
 * WhatsApp has no attachment on an interactive message, so a file is not part
 * of the card at all — it is sent as its own message just before it, the way a
 * second picture is. The order here is the order of delivery.
 *
 * A picture is optimised on the way in; a file is not. Re-encoding a `.docx`
 * or a PDF would break the customer's download, so the bytes are stored as
 * they arrived and only the type and the size are checked.
 *
 * Each stored file carries a bin that deletes it from the bucket for good. It
 * arms on the first click, deletes on the second, and refuses while this card
 * or any other card still sends the file.
 */

const DOCUMENT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "csv",
];

const VIDEO_EXTENSIONS = ["mp4", "3gp"];

const ACCEPT = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "video/mp4",
  "video/3gpp",
].join(",");

/** One file on its way in, so a slow upload is visible rather than silent. */
interface InFlight {
  id: string;
  name: string;
  /** Null while it is still being stored. */
  error: string | null;
}

/**
 * The listed files, with the agent they were listed for.
 *
 * One value rather than two states, because the pair must agree: a list left
 * over from the agent just switched away from is never drawn.
 */
interface Library {
  agentId: string;
  files: CardFileUpload[];
  error: string | null;
}

const KINDS: Record<CardFile["kind"], string> = {
  document: "Document",
  video: "Video",
};

export function CardFileField({
  agentId,
  cardId,
  value,
  disabled,
  usedBy,
  onChange,
}: {
  agentId: string;
  /** The card being edited, so an upload that outlives a card switch still lands right. */
  cardId: string;
  value: CardFile[];
  disabled: boolean;
  /**
   * The draft's other cards that already send a file, by address. A draft
   * points at files the server has never seen saved, so the refusal that keeps
   * a card from pointing at a deleted file has to happen here too.
   */
  usedBy?: (url: string) => string[];
  onChange: (files: CardFile[]) => void;
}) {
  const [library, setLibrary] = React.useState<Library | null>(null);
  const [queue, setQueue] = React.useState<InFlight[]>([]);
  const [dragging, setDragging] = React.useState(false);

  /** The path armed by one click on its bin; the next click deletes it. */
  const [pending, setPending] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [removeError, setRemoveError] = React.useState<string | null>(null);
  /** A refusal and the card it belongs to, so switching cards cannot leave it behind. */
  const [notice, setNotice] = React.useState<{
    cardId: string;
    message: string;
  } | null>(null);

  const picker = React.useRef<HTMLInputElement>(null);

  /** False once the field is unmounted, so a slow upload cannot write to another card. */
  const alive = React.useRef(true);

  React.useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  React.useEffect(() => {
    let live = true;

    void (async () => {
      try {
        const listed = await fetchCardMedia(agentId);

        if (live) {
          setLibrary({ agentId, files: listed.files, error: null });
        }
      } catch (error) {
        if (live) {
          // Cleared rather than kept: tiles of the agent this one replaced must
          // not stand in for files this agent does not have.
          setLibrary({
            agentId,
            files: [],
            error:
              error instanceof ApiError
                ? error.message
                : "The files already uploaded could not be listed.",
          });
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [agentId]);

  const own = library?.agentId === agentId ? library : null;
  const files = own?.files ?? [];
  const libraryError = own?.error ?? null;

  React.useEffect(() => {
    if (!pending) return;

    const timer = window.setTimeout(() => setPending(null), 4_000);

    return () => window.clearTimeout(timer);
  }, [pending]);

  /**
   * The card's files as this field understands them.
   *
   * Trimmed and deduplicated on the way in: the server refuses a duplicate on
   * save, and a repeated address would send the same file twice.
   */
  const chosen = React.useMemo(() => {
    const seen = new Set<string>();

    return value
      .map((file) => ({ ...file, url: file.url.trim() }))
      .filter((file) => {
        if (file.url.length === 0 || seen.has(file.url)) return false;

        seen.add(file.url);
        return true;
      });
  }, [value]);

  /** The refusal for this card, or null. A message from another card is not shown. */
  const actionError = notice?.cardId === cardId ? notice.message : null;

  /**
   * The card the files are going on, and its list so far.
   *
   * Batched uploads finish one after another, and each must append to the list
   * the one before it produced — the `value` prop lags by a render.
   */
  const current = React.useRef({ cardId, files: chosen });

  React.useEffect(() => {
    current.current = { cardId, files: chosen };
  }, [cardId, chosen]);

  /** The list this click belongs to, preferring what this field last wrote. */
  function filesHere(): CardFile[] {
    return current.current.cardId === cardId ? current.current.files : chosen;
  }

  /** Appends one file, unless it is already there or the card is full. */
  const add = React.useCallback(
    (file: CardFile): boolean => {
      const clean = { ...file, url: file.url.trim() };

      if (disabled || clean.url.length === 0) return false;

      const list = filesHere();

      if (list.some((entry) => entry.url === clean.url)) {
        setNotice({ cardId, message: "That file is already on this card." });
        return false;
      }

      if (list.length >= MAX_CARD_FILES) {
        setNotice({
          cardId,
          message: `A card can send at most ${MAX_CARD_FILES} files. Take one off before adding another.`,
        });
        return false;
      }

      const next = [...list, clean];
      current.current = { cardId, files: next };
      setNotice(null);
      onChange(next);

      return true;
    },
    // `chosen` and the ref are read together, so the closure must move with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardId, chosen, disabled, onChange],
  );

  /** Takes a file off the card. The file stays in storage, untouched. */
  const takeOff = React.useCallback(
    (at: number): void => {
      if (disabled) return;

      const next = filesHere().filter((_, index) => index !== at);

      current.current = { cardId, files: next };
      setNotice(null);
      onChange(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardId, chosen, disabled, onChange],
  );

  /** Swaps a file with its neighbour, which is the whole of the order. */
  const move = React.useCallback(
    (at: number, step: -1 | 1): void => {
      if (disabled) return;

      const list = [...filesHere()];
      const to = at + step;
      const here = list[at];
      const there = list[to];

      if (here === undefined || there === undefined) return;

      list[at] = there;
      list[to] = here;
      current.current = { cardId, files: list };
      setNotice(null);
      onChange(list);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardId, chosen, disabled, onChange],
  );

  const addPicked = React.useCallback(
    (picked: File[]): void => {
      if (disabled || picked.length === 0) return;

      const rows: InFlight[] = picked.map((file) => ({
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        error: problemWith(file),
      }));

      setQueue((current) => [...current, ...rows]);

      for (const [at, file] of picked.entries()) {
        const row = rows[at];

        if (row.error) continue;

        void (async () => {
          try {
            const stored = await uploadCardMedia(agentId, file);

            // The picker only takes documents and videos, so the other arm
            // means the server read the bytes as a picture. Refused rather
            // than filed as a download that would never arrive.
            if (stored.type !== "file") {
              setQueue((current) =>
                current.map((entry) =>
                  entry.id === row.id
                    ? { ...entry, error: "That upload came back as a picture." }
                    : entry,
                ),
              );
              return;
            }

            setLibrary((current) => ({
              agentId,
              error: null,
              files: [
                stored,
                ...(current?.agentId === agentId ? current.files : []).filter(
                  (entry) => entry.path !== stored.path,
                ),
              ],
            }));

            // Nothing is written once this field is gone: the card on screen
            // would belong to another agent by then.
            if (alive.current) add(stored);
          } catch (error) {
            const message =
              error instanceof ApiError
                ? error.message
                : "That file could not be stored.";

            setQueue((current) =>
              current.map((entry) =>
                entry.id === row.id ? { ...entry, error: message } : entry,
              ),
            );
            return;
          }

          setQueue((current) => current.filter((entry) => entry.id !== row.id));
        })();
      }
    },
    [add, agentId, disabled],
  );

  /**
   * Deletes one upload from the bucket, for good.
   *
   * This card is checked first, then the draft's other cards, then the server
   * checks the saved flow; each names what holds the file.
   */
  const remove = React.useCallback(
    async (tile: CardFileUpload): Promise<void> => {
      if (chosen.some((file) => file.url === tile.url)) {
        setPending(null);
        setRemoveError(
          "This card still sends this file. Take it off the card before deleting it.",
        );
        return;
      }

      const others = usedBy?.(tile.url) ?? [];

      if (others.length > 0) {
        setPending(null);
        setRemoveError(
          `${others.join(", ")} ${others.length === 1 ? "still sends" : "still send"} this file. Give ${others.length === 1 ? "that card" : "those cards"} another file first.`,
        );
        return;
      }

      setRemoving(tile.path);
      setRemoveError(null);

      try {
        await removeCardMedia(agentId, tile.path);

        setLibrary((current) =>
          current?.agentId === agentId
            ? {
                ...current,
                files: current.files.filter((file) => file.path !== tile.path),
              }
            : current,
        );
      } catch (error) {
        setRemoveError(
          error instanceof ApiError
            ? error.message
            : "That file could not be removed.",
        );
      } finally {
        setRemoving(null);
        setPending(null);
      }
    },
    [agentId, chosen, usedBy],
  );

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "rounded-lg border border-dashed px-3 py-3 text-center transition-colors",
          dragging
            ? "border-foreground bg-secondary/70"
            : "border-border bg-secondary/30",
          disabled && "opacity-60",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addPicked([...event.dataTransfer.files]);
        }}
      >
        <UploadCloud
          aria-hidden="true"
          className="mx-auto size-5 text-muted-foreground"
          strokeWidth={1.75}
        />
        <p className="mt-1.5 text-[12px] text-foreground">
          Drop a file here, or{" "}
          <button
            type="button"
            className="rounded-sm underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-40"
            disabled={disabled}
            onClick={() => picker.current?.click()}
          >
            choose a file
          </button>
        </p>
        <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
          PDF, Word, Excel, PowerPoint, text or CSV up to{" "}
          {megabytes(MAX_CARD_FILE_BYTES)} MB; MP4 or 3GP video up to{" "}
          {megabytes(MAX_CARD_VIDEO_BYTES)} MB. Stored in Supabase as it is, so
          the customer downloads the file you picked.
        </p>
        <input
          ref={picker}
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled}
          multiple
          type="file"
          onChange={(event) => {
            const picked = [...(event.target.files ?? [])];
            // Cleared so choosing the same file again still fires a change.
            event.target.value = "";
            addPicked(picked);
          }}
        />
      </div>

      {queue.length > 0 ? (
        <div className="space-y-1.5">
          {queue.map((row) => (
            <div
              className={cn(
                "flex items-start gap-2 rounded-lg border px-2.5 py-1.5",
                row.error
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-border bg-card",
              )}
              key={row.id}
            >
              {row.error ? (
                <AlertCircle
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-destructive"
                />
              ) : (
                <Loader2
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground"
                />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-[11.5px]",
                    row.error ? "text-destructive" : "text-foreground",
                  )}
                >
                  {row.name}
                </p>
                <p
                  className={cn(
                    "text-[10.5px] leading-relaxed",
                    row.error ? "text-destructive/90" : "text-muted-foreground",
                  )}
                >
                  {row.error ?? "Storing…"}
                </p>
              </div>
              {row.error ? (
                <button
                  type="button"
                  aria-label={`Dismiss ${row.name}`}
                  className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  onClick={() =>
                    setQueue((current) =>
                      current.filter((entry) => entry.id !== row.id),
                    )
                  }
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {chosen.length > 0 ? (
        <div className="rounded-lg border border-border bg-card p-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-medium text-foreground">
              Sent in this order
            </p>
            <p className="text-[10.5px] tabular-nums text-muted-foreground">
              {chosen.length} of {MAX_CARD_FILES} files
            </p>
          </div>

          <ol className="mt-1.5 space-y-1">
            {chosen.map((file, at) => (
              <li
                className="flex items-center gap-2 rounded-md border border-border px-2 py-1"
                key={file.url}
              >
                <KindIcon kind={file.kind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] text-foreground">
                    {file.name}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {KINDS[file.kind]} · position {at + 1}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Send this file ${at === 0 ? "after the next one" : "earlier"}`}
                  className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                  disabled={disabled || at === 0}
                  onClick={() => move(at, -1)}
                >
                  <ChevronLeft aria-hidden="true" className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Take this file off the card"
                  className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  disabled={disabled}
                  onClick={() => takeOff(at)}
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Send this file ${at === chosen.length - 1 ? "before the previous one" : "later"}`}
                  className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                  disabled={disabled || at === chosen.length - 1}
                  onClick={() => move(at, 1)}
                >
                  <ChevronRight aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            ))}
          </ol>

          <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
            Each file is sent as its own message, in this order, just before
            the card — and before the pictures.
          </p>
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className="rounded-lg border border-border bg-card p-2">
          <p className="text-[11px] font-medium text-foreground">
            Uploaded earlier
          </p>
          <ul className="mt-1.5 space-y-1">
            {files.map((file) => {
              const picked = chosen.some((entry) => entry.url === file.url);
              const armed = pending === file.path;
              const busy = removing === file.path;

              return (
                <li
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2 py-1 transition-colors",
                    picked ? "border-foreground/50 bg-secondary/60" : "border-border",
                    disabled && "opacity-60",
                  )}
                  key={file.path}
                >
                  <KindIcon kind={file.kind} />
                  <button
                    type="button"
                    aria-pressed={picked}
                    className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                    disabled={disabled}
                    title={file.url}
                    onClick={() => {
                      if (picked) {
                        takeOff(chosen.findIndex((entry) => entry.url === file.url));
                        return;
                      }

                      add(file);
                    }}
                  >
                    <span className="block truncate text-[11.5px] text-foreground">
                      {file.name}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      {picked ? "On this card" : `${KINDS[file.kind]} · click to send`}
                    </span>
                  </button>

                  {/* Its own button: a delete inside the row's button would be
                      invalid markup and would swallow the row's own tap. */}
                  <button
                    type="button"
                    aria-label={
                      armed
                        ? "Click again to delete this file for good"
                        : "Remove this file from storage"
                    }
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-full text-white shadow-sm transition-colors disabled:opacity-50",
                      armed ? "bg-destructive" : "bg-black/45 hover:bg-destructive",
                    )}
                    disabled={disabled || busy}
                    title={
                      armed
                        ? "Click again to delete it from Supabase for good"
                        : "Remove this file from storage"
                    }
                    onClick={() => {
                      setRemoveError(null);

                      // The file cannot be brought back, so one stray click must
                      // not delete it: the first arms this bin, the second does it.
                      if (armed) {
                        void remove(file);
                        return;
                      }

                      setPending(file.path);
                    }}
                  >
                    {busy ? (
                      <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                    ) : (
                      <Trash2 aria-hidden="true" className="size-3" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
            The bin deletes an upload from Supabase for good — click it twice.
          </p>
        </div>
      ) : null}

      {removeError ? (
        <p className="text-[10.5px] leading-relaxed text-destructive">
          {removeError}
        </p>
      ) : null}

      {actionError ? (
        <p className="text-[10.5px] leading-relaxed text-destructive">
          {actionError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-40"
          disabled={disabled || chosen.length === 0}
          onClick={() => {
            current.current = { cardId, files: [] };
            setNotice(null);
            onChange([]);
          }}
        >
          No files
        </button>
      </div>

      {libraryError ? (
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          {libraryError} Uploading still works.
        </p>
      ) : null}
    </div>
  );
}

/** The picture for a file's kind, so a video does not read as a document. */
function KindIcon({ kind }: { kind: CardFileKind }) {
  const Icon = kind === "video" ? Film : FileText;

  return (
    <Icon
      aria-hidden="true"
      className="size-4 shrink-0 text-muted-foreground"
    />
  );
}

function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/** The extension of a chosen file, lower-cased; blank when it has none. */
function extensionOf(name: string): string {
  const at = name.lastIndexOf(".");

  return at >= 0 ? name.slice(at + 1).toLowerCase() : "";
}

/**
 * The browser-side gate: the same types and sizes the API enforces.
 *
 * Read from the name, not the MIME type: browsers report an MP4 or a 3GP file
 * as `application/octet-stream` often enough that the type alone would refuse
 * files the server accepts.
 */
function problemWith(file: File): string | null {
  const extension = extensionOf(file.name);
  const video = VIDEO_EXTENSIONS.includes(extension);

  if (!video && !DOCUMENT_EXTENSIONS.includes(extension)) {
    return "Cards can send a PDF, Word, Excel, PowerPoint, text or CSV file, or an MP4 or 3GP video.";
  }

  const cap = video ? MAX_CARD_VIDEO_BYTES : MAX_CARD_FILE_BYTES;

  if (file.size > cap) {
    return `That ${video ? "video" : "file"} is larger than ${megabytes(cap)} MB.`;
  }

  return null;
}