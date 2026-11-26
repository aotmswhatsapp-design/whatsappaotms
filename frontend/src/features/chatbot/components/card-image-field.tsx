"use client";

import * as React from "react";
import {
  AlertCircle,
  Check,
  Loader2,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ApiError,
  fetchCardImages,
  removeCardImage,
  uploadCardImage,
  type CardImage,
} from "../api";

/**
 * The Picture field, as a drop target and a gallery.
 *
 * A card shows one picture, but the upload accepts many at once: a customer
 * usually has a folder of dish photos, and dropping the set once is faster
 * than repeating the field for each card. What is stored is the optimised file
 * (rotated, resized to 1080 px, JPEG) in Supabase, so the address written into
 * the flow is the same file every customer will receive.
 *
 * Each stored picture carries a bin that deletes it from the bucket for good.
 * It arms on the first click and deletes on the second, and it refuses while a
 * card still shows the picture — a saved card the server knows about, or one
 * of the draft's other cards, which only this screen can see.
 */

const ACCEPT = "image/jpeg,image/png,image/webp";

/** Mirrors the API's own limit, so an oversized file fails without a round trip. */
const MAX_BYTES = 5 * 1024 * 1024;

const FIELD =
  "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-[12.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60";

/** One file on its way in, so a slow upload is visible rather than silent. */
interface InFlight {
  id: string;
  name: string;
  /** Null while it is still being optimised and stored. */
  error: string | null;
}

export function CardImageField({
  agentId,
  value,
  disabled,
  usedBy,
  onChange,
}: {
  agentId: string;
  value: string | null;
  disabled: boolean;
  /**
   * The draft's other cards that already show a picture, by address. A draft
   * points at files the server has never seen saved, so the refusal that keeps
   * a card from ending up with a dead address has to happen here too.
   */
  usedBy?: (url: string) => string[];
  onChange: (url: string | null) => void;
}) {
  const [images, setImages] = React.useState<CardImage[]>([]);
  const [queue, setQueue] = React.useState<InFlight[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [libraryError, setLibraryError] = React.useState<string | null>(null);
  const [linkOpen, setLinkOpen] = React.useState(false);

  /** The path armed by one click on its bin; the next click deletes it. */
  const [pending, setPending] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [removeError, setRemoveError] = React.useState<string | null>(null);

  const picker = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let live = true;

    void (async () => {
      try {
        const listed = await fetchCardImages(agentId);

        if (live) {
          setImages(listed.images);
          setLibraryError(null);
        }
      } catch (error) {
        if (live) {
          setLibraryError(
            error instanceof ApiError
              ? error.message
              : "The pictures already uploaded could not be listed.",
          );
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [agentId]);

  React.useEffect(() => {
    if (!pending) return;

    // The first click only arms the bin; a stray one expires instead of
    // leaving a delete button waiting for a second click that was never meant.
    const timer = window.setTimeout(() => setPending(null), 4_000);

    return () => window.clearTimeout(timer);
  }, [pending]);

  const addFiles = React.useCallback(
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
            const stored = await uploadCardImage(agentId, file);

            setImages((current) => [
              { url: stored.url, path: stored.path },
              ...current.filter((image) => image.path !== stored.path),
            ]);

            // The picture just dropped is the one the agent is looking at, so
            // it becomes the card's picture: keeping an older one would hide
            // the upload that prompted the change. The rest stay in the
            // gallery to switch back to.
            onChange(stored.url);
          } catch (error) {
            const message =
              error instanceof ApiError
                ? error.message
                : "That picture could not be stored.";

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
    [agentId, disabled, onChange],
  );

  const selected = value?.trim() || null;

  /**
   * Deletes one upload from the bucket, for good.
   *
   * The draft is checked first, then the server checks the saved flow; both
   * name the card that holds the picture, because "in use" without a name
   * leaves the agent hunting cards for the one they have to change.
   */
  const remove = React.useCallback(
    async (tile: { url: string; path: string }): Promise<void> => {
      const others = usedBy?.(tile.url) ?? [];

      if (others.length > 0) {
        setPending(null);
        setRemoveError(
          `${others.join(", ")} ${others.length === 1 ? "still uses" : "still use"} this picture. Give ${others.length === 1 ? "that card" : "those cards"} another picture first.`,
        );
        return;
      }

      setRemoving(tile.path);
      setRemoveError(null);

      try {
        await removeCardImage(agentId, tile.path);

        setImages((current) =>
          current.filter((image) => image.path !== tile.path),
        );

        // The card would otherwise keep an address that no longer answers.
        if (tile.url === selected) onChange(null);
      } catch (error) {
        setRemoveError(
          error instanceof ApiError
            ? error.message
            : "That picture could not be removed.",
        );
      } finally {
        setRemoving(null);
        setPending(null);
      }
    },
    [agentId, onChange, selected, usedBy],
  );

  /** Every stored picture, plus a pasted link that is not one of them. */
  const tiles = React.useMemo(() => {
    const list = images.map((image) => ({
      url: image.url,
      path: image.path,
      stored: true,
    }));

    if (selected && !list.some((image) => image.url === selected)) {
      // A pasted address is not ours to delete, so it carries no bin.
      list.unshift({ url: selected, path: selected, stored: false });
    }

    return list;
  }, [images, selected]);

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
          addFiles([...event.dataTransfer.files]);
        }}
      >
        <UploadCloud
          aria-hidden="true"
          className="mx-auto size-5 text-muted-foreground"
          strokeWidth={1.75}
        />
        <p className="mt-1.5 text-[12px] text-foreground">
          Drop pictures here, or{" "}
          <button
            type="button"
            className="rounded-sm underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-40"
            disabled={disabled}
            onClick={() => picker.current?.click()}
          >
            choose files
          </button>
        </p>
        <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
          JPEG, PNG or WebP, up to 5 MB each. Every picture is optimised on the
          way in and stored in Supabase; this card shows the one you pick.
        </p>
        <input
          ref={picker}
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled}
          multiple
          type="file"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            // Cleared so choosing the same file again still fires a change.
            event.target.value = "";
            addFiles(files);
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
                  {row.error ?? "Optimising and storing…"}
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

      {tiles.length > 0 ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {tiles.map((tile) => {
            const picked = tile.url === selected;
            const armed = pending === tile.path;
            const busy = removing === tile.path;

            return (
              <div
                className={cn(
                  "group relative aspect-square overflow-hidden rounded-md border bg-secondary transition-colors",
                  picked
                    ? "border-foreground ring-2 ring-ring/30"
                    : "border-border hover:border-foreground/40",
                  disabled && "opacity-60",
                )}
                key={tile.path}
              >
                <button
                  type="button"
                  aria-label={picked ? "This picture is used" : "Use this picture"}
                  aria-pressed={picked}
                  className="size-full disabled:cursor-not-allowed"
                  disabled={disabled}
                  title={tile.url}
                  onClick={() => onChange(tile.url)}
                >
                  {/* A stored card picture is already an optimised 1080 px JPEG
                      on a public bucket: `next/image` would add a proxy hop and
                      re-encode it a second time. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                    src={tile.url}
                  />
                  {picked ? (
                    <span className="absolute inset-0 grid place-items-center bg-black/35 text-white">
                      <Check aria-hidden="true" className="size-4" strokeWidth={2.5} />
                    </span>
                  ) : (
                    <span className="absolute inset-x-0 bottom-0 hidden bg-black/45 py-0.5 text-center text-[10px] text-white group-hover:block">
                      Use
                    </span>
                  )}
                </button>

                {/* Its own button, not nested inside the tile: a delete inside
                    a button is invalid markup and swallows the tile's own tap. */}
                {tile.stored ? (
                  <button
                    type="button"
                    aria-label={
                      armed
                        ? "Click again to delete this picture for good"
                        : "Remove this picture from storage"
                    }
                    className={cn(
                      "absolute top-1 right-1 grid size-5 place-items-center rounded-full text-white shadow-sm transition-colors disabled:opacity-50",
                      armed ? "bg-destructive" : "bg-black/55 hover:bg-destructive",
                    )}
                    disabled={disabled || busy}
                    title={
                      armed
                        ? "Click again to delete it from Supabase for good"
                        : "Remove this picture from storage"
                    }
                    onClick={() => {
                      setRemoveError(null);

                      // The file cannot be brought back, so one stray click must
                      // not delete it: the first arms this bin, the second does it.
                      if (armed) {
                        void remove(tile);
                        return;
                      }

                      setPending(tile.path);
                    }}
                  >
                    {busy ? (
                      <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                    ) : (
                      <Trash2 aria-hidden="true" className="size-3" />
                    )}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {tiles.some((tile) => tile.stored) ? (
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          The bin deletes an upload from Supabase for good — click it twice.
        </p>
      ) : null}

      {removeError ? (
        <p className="text-[10.5px] leading-relaxed text-destructive">
          {removeError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-40"
          disabled={disabled || !selected}
          onClick={() => onChange(null)}
        >
          No picture
        </button>
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-40"
          disabled={disabled}
          onClick={() => setLinkOpen((open) => !open)}
        >
          {linkOpen ? "Hide the link field" : "Use a picture from somewhere else"}
        </button>
      </div>

      {linkOpen ? (
        <div key="link">
          <input
            aria-label="Picture address"
            className={FIELD}
            disabled={disabled}
            inputMode="url"
            placeholder="https://…"
            spellCheck={false}
            value={value ?? ""}
            onChange={(event) =>
              onChange(event.target.value.trim() || null)
            }
          />
          <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
            A public https:// address. WhatsApp fetches it from its own server,
            so it cannot be a file on this computer.
          </p>
        </div>
      ) : null}

      {libraryError ? (
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          {libraryError} Uploading still works.
        </p>
      ) : null}
    </div>
  );
}

/** The browser-side gate: the same file types and size the API enforces. */
function problemWith(file: File): string | null {
  if (!ACCEPT.split(",").includes(file.type)) {
    return "Only JPEG, PNG and WebP pictures can be used.";
  }

  if (file.size > MAX_BYTES) {
    return "That picture is larger than 5 MB.";
  }

  return null;
}
