"use client";

import * as React from "react";
import {
  AlertCircle,
  Check,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { ApiError, fetchCardImages, uploadCardImage, type CardImage } from "../api";

/**
 * The Picture field, as a drop target and a gallery.
 *
 * A card shows one picture, but the upload accepts many at once: a customer
 * usually has a folder of dish photos, and dropping the set once is faster
 * than repeating the field for each card. What is stored is the optimised file
 * (rotated, resized to 1080 px, JPEG) in Supabase, so the address written into
 * the flow is the same file every customer will receive.
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
  onChange,
}: {
  agentId: string;
  value: string | null;
  disabled: boolean;
  onChange: (url: string | null) => void;
}) {
  const [images, setImages] = React.useState<CardImage[]>([]);
  const [queue, setQueue] = React.useState<InFlight[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [libraryError, setLibraryError] = React.useState<string | null>(null);
  const [linkOpen, setLinkOpen] = React.useState(false);

  const picker = React.useRef<HTMLInputElement>(null);

  // Read inside an upload's callback: the answer arrives after a re-render, and
  // the decision "does this card already show a picture" must use the latest
  // answer rather than the one from when the drop happened.
  const chosen = React.useRef(value);

  React.useEffect(() => {
    chosen.current = value;
  }, [value]);

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

            // The picture that was just dropped is the obvious choice, but a
            // card that already shows one keeps it: growing the gallery must
            // not quietly change what customers see.
            if (!chosen.current) {
              chosen.current = stored.url;
              onChange(stored.url);
            }
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

  /** Every stored picture, plus a pasted link that is not one of them. */
  const tiles = React.useMemo(() => {
    const list = images.map((image) => ({ url: image.url, path: image.path }));

    if (selected && !list.some((image) => image.url === selected)) {
      list.unshift({ url: selected, path: selected });
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

            return (
              <button
                type="button"
                aria-label={picked ? "This picture is used" : "Use this picture"}
                aria-pressed={picked}
                className={cn(
                  "group relative aspect-square overflow-hidden rounded-md border bg-secondary transition-colors",
                  picked
                    ? "border-foreground ring-2 ring-ring/30"
                    : "border-border hover:border-foreground/40",
                  disabled && "cursor-not-allowed opacity-60",
                )}
                disabled={disabled}
                key={tile.path}
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
            );
          })}
        </div>
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
