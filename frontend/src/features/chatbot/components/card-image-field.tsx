"use client";

import * as React from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import { MAX_CARD_IMAGES } from "@/lib/bots/limits";
import { cn } from "@/lib/utils";
import {
  ApiError,
  fetchCardImages,
  removeCardImage,
  uploadCardImage,
  type CardImage,
} from "../api";

/**
 * The Pictures field, as a drop target, a gallery and the card's own order.
 *
 * WhatsApp has no album: one picture on a card with buttons becomes that
 * bubble's header, and every other picture is sent as its own image message
 * before the card. So the order here is the order of delivery, and it is worth
 * letting the owner set it — the first picture is the one that reads as the
 * cover when the card has buttons.
 *
 * Uploads accept many files at once and are appended in the order they finish,
 * which is faster than opening the field once per picture. Each stored picture
 * is the optimised file (rotated, resized to 1080 px, JPEG) in Supabase, so the
 * address written into the flow is the same file every customer receives.
 *
 * Each stored picture carries a bin that deletes it from the bucket for good.
 * It arms on the first click and deletes on the second, and it refuses while
 * this card or any other card still shows the picture — a saved card the
 * server knows about, or one of the draft's other cards, which only this
 * screen can see.
 */

const ACCEPT = "image/jpeg,image/png,image/webp";

/** Mirrors the API's own limit, so an oversized file fails without a round trip. */
const MAX_BYTES = 5 * 1024 * 1024;

/** One shared empty list, so a gallery with nothing in it is the same value each time. */
const NO_IMAGES: CardImage[] = [];

const FIELD =
  "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-[12.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60";

/** One file on its way in, so a slow upload is visible rather than silent. */
interface InFlight {
  id: string;
  name: string;
  /** Null while it is still being optimised and stored. */
  error: string | null;
}

/**
 * The listed gallery, with the agent it was listed for.
 *
 * One value rather than two states, because the pair must agree: a list left
 * over from the agent just switched away from is never drawn, even for the
 * moment the next list takes to arrive.
 */
interface Library {
  agentId: string;
  images: CardImage[];
  error: string | null;
}

export function CardImageField({
  agentId,
  cardId,
  value,
  disabled,
  usedBy,
  onChange,
}: {
  agentId: string;
  /**
   * The card being edited. An upload finishes long after the drop, and the
   * owner may have moved to another card by then; the id is how this field
   * tells "still my card" from "somebody else's".
   */
  cardId: string;
  value: string[];
  disabled: boolean;
  /**
   * The draft's other cards that already show a picture, by address. A draft
   * points at files the server has never seen saved, so the refusal that keeps
   * a card from ending up with a dead address has to happen here too.
   */
  usedBy?: (url: string) => string[];
  onChange: (urls: string[]) => void;
}) {
  const [library, setLibrary] = React.useState<Library | null>(null);
  const [queue, setQueue] = React.useState<InFlight[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkDraft, setLinkDraft] = React.useState("");

  /** The path armed by one click on its bin; the next click deletes it. */
  const [pending, setPending] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [removeError, setRemoveError] = React.useState<string | null>(null);
  /**
   * A refusal and the card it belongs to. One value, not a message plus a
   * reset: switching cards must not leave "already on this card" sitting
   * under a picture that is not, and that is a comparison, not an effect.
   */
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
        const listed = await fetchCardImages(agentId);

        if (live) {
          setLibrary({ agentId, images: listed.images, error: null });
        }
      } catch (error) {
        if (live) {
          // Cleared rather than kept: tiles of the agent this one replaced must
          // not stand in for pictures this agent does not have.
          setLibrary({
            agentId,
            images: [],
            error:
              error instanceof ApiError
                ? error.message
                : "The pictures already uploaded could not be listed.",
          });
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [agentId]);

  const own = library?.agentId === agentId ? library : null;

  /** Only this agent's list: another agent's is not drawn, even for a frame. */
  const images = own?.images ?? NO_IMAGES;
  const libraryError = own?.error ?? null;

  React.useEffect(() => {
    if (!pending) return;

    // The first click only arms the bin; a stray one expires instead of
    // leaving a delete button waiting for a second click that was never meant.
    const timer = window.setTimeout(() => setPending(null), 4_000);

    return () => window.clearTimeout(timer);
  }, [pending]);

  /**
   * The card's pictures as this field understands them.
   *
   * Trimmed and deduplicated on the way in: the server refuses a duplicate on
   * save, and a repeated address would send the same picture twice.
   */
  const chosen = React.useMemo(() => {
    const seen = new Set<string>();

    return value
      .map((url) => url.trim())
      .filter((url) => {
        if (url.length === 0 || seen.has(url)) return false;

        seen.add(url);
        return true;
      });
  }, [value]);

  /** The refusal for this card, or null. A message from another card is not shown. */
  const actionError = notice?.cardId === cardId ? notice.message : null;

  /**
   * The card the pictures are going on, and its list so far.
   *
   * Batched uploads finish one after another, and each must append to the list
   * the one before it produced — the `value` prop lags by a render. Writing the
   * new list here at the same moment `onChange` is called keeps the order the
   * uploads finished in. The id travels with it so an upload that outlived a
   * card switch appends to the card it was dropped on, not the one on screen.
   */
  const current = React.useRef({ cardId, urls: chosen });

  React.useEffect(() => {
    current.current = { cardId, urls: chosen };
  }, [cardId, chosen]);

  /** The list this click belongs to, preferring what this field last wrote. */
  function urlsHere(): string[] {
    return current.current.cardId === cardId ? current.current.urls : chosen;
  }

  /**
   * Appends one picture, unless it is already there or the card is full.
   *
   * Answers false when nothing was added, so a caller holding a typed address
   * can keep it instead of clearing the field for a picture that did not go on.
   */
  const add = React.useCallback(
    (url: string): boolean => {
      const clean = url.trim();

      if (disabled || clean.length === 0) return false;

      const urls = urlsHere();

      if (urls.includes(clean)) {
        setNotice({ cardId, message: "That picture is already on this card." });
        return false;
      }

      if (urls.length >= MAX_CARD_IMAGES) {
        setNotice({
          cardId,
          message: `A card can send at most ${MAX_CARD_IMAGES} pictures. Take one off before adding another.`,
        });
        return false;
      }

      const next = [...urls, clean];
      current.current = { cardId, urls: next };
      setNotice(null);
      onChange(next);

      return true;
    },
    // `chosen` and the ref are read together, so the closure must move with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardId, chosen, disabled, onChange],
  );

  /** Takes a picture off the card. The file stays in the gallery, untouched. */
  const takeOff = React.useCallback(
    (at: number): void => {
      if (disabled) return;

      const next = urlsHere().filter((_, index) => index !== at);

      current.current = { cardId, urls: next };
      setNotice(null);
      onChange(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardId, chosen, disabled, onChange],
  );

  /** Swaps a picture with its neighbour, which is the whole of the order. */
  const move = React.useCallback(
    (at: number, step: -1 | 1): void => {
      if (disabled) return;

      const urls = [...urlsHere()];
      const to = at + step;
      const here = urls[at];
      const there = urls[to];

      if (here === undefined || there === undefined) return;

      urls[at] = there;
      urls[to] = here;
      current.current = { cardId, urls };
      setNotice(null);
      onChange(urls);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardId, chosen, disabled, onChange],
  );

  const clearAll = React.useCallback((): void => {
    if (disabled) return;

    current.current = { cardId, urls: [] };
    setNotice(null);
    onChange([]);
  }, [cardId, disabled, onChange]);

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

            setLibrary((current) => ({
              agentId,
              error: null,
              images: [
                { url: stored.url, path: stored.path },
                ...(current?.agentId === agentId ? current.images : []).filter(
                  (image) => image.path !== stored.path,
                ),
              ],
            }));

            // Appended, not substituted: dropping a folder of dish photos
            // builds the card's order in one go, which is the point of the
            // multi-file picker. Nothing is written once this field is gone:
            // the card on screen would belong to another agent by then.
            if (alive.current) add(stored.url);
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
    [add, agentId, disabled],
  );

  /**
   * Deletes one upload from the bucket, for good.
   *
   * This card is checked first, then the draft's other cards, then the server
   * checks the saved flow; each names what holds the picture, because "in use"
   * without a name leaves the agent hunting cards for the one to change.
   */
  const remove = React.useCallback(
    async (tile: { url: string; path: string }): Promise<void> => {
      if (chosen.includes(tile.url)) {
        setPending(null);
        setRemoveError(
          "This card still sends this picture. Take it off the card before deleting the file.",
        );
        return;
      }

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

        setLibrary((current) =>
          current?.agentId === agentId
            ? {
                ...current,
                images: current.images.filter(
                  (image) => image.path !== tile.path,
                ),
              }
            : current,
        );
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
    [agentId, chosen, usedBy],
  );

  /** Every stored picture, plus any pasted address that is not one of them. */
  const tiles = React.useMemo(() => {
    const list = images.map((image) => ({
      url: image.url,
      path: image.path,
      stored: true,
    }));

    // A pasted address is not ours to delete, so it carries no bin.
    const pasted = chosen
      .filter((url) => !list.some((image) => image.url === url))
      .map((url) => ({ url, path: url, stored: false }));

    return [...pasted, ...list];
  }, [images, chosen]);

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
          JPEG, PNG or WebP, up to 5 MB each. Each picture is optimised and
          stored in Supabase, then added to this card in the order you pick.
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

      {chosen.length > 0 ? (
        <div className="rounded-lg border border-border bg-card p-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-medium text-foreground">
              Sent in this order
            </p>
            <p className="text-[10.5px] tabular-nums text-muted-foreground">
              {chosen.length} of {MAX_CARD_IMAGES} pictures
            </p>
          </div>

          <ol className="mt-1.5 flex flex-wrap gap-2">
            {chosen.map((url, at) => (
              <li className="w-16" key={url}>
                <div className="relative aspect-square overflow-hidden rounded-md border border-border bg-secondary">
                  {/* A stored card picture is already an optimised 1080 px
                      JPEG on a public bucket: `next/image` would add a proxy
                      hop and re-encode it a second time. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                    src={url}
                  />
                  <span className="absolute top-0.5 left-0.5 rounded-sm bg-black/65 px-1 text-[9.5px] leading-4 font-medium text-white">
                    {at === 0 ? "First" : at + 1}
                  </span>
                </div>

                <div className="mt-0.5 flex items-center justify-between">
                  <button
                    type="button"
                    aria-label={`Send this picture ${at === 0 ? "after the next one" : "earlier"}`}
                    className="grid size-4 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                    disabled={disabled || at === 0}
                    onClick={() => move(at, -1)}
                  >
                    <ChevronLeft aria-hidden="true" className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Take this picture off the card"
                    className="grid size-4 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                    disabled={disabled}
                    onClick={() => takeOff(at)}
                  >
                    <X aria-hidden="true" className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Send this picture ${at === chosen.length - 1 ? "before the previous one" : "later"}`}
                    className="grid size-4 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                    disabled={disabled || at === chosen.length - 1}
                    onClick={() => move(at, 1)}
                  >
                    <ChevronRight aria-hidden="true" className="size-3" />
                  </button>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
            {chosen.length === 1
              ? "With at least one button, this picture becomes the card's header. Without one, it is sent first and the card follows as a sentence."
              : "The first is the cover when the card has buttons; every picture is sent, each as its own message, before the card."}
          </p>
        </div>
      ) : null}

      {tiles.length > 0 ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {tiles.map((tile) => {
            const position = chosen.indexOf(tile.url);
            const picked = position >= 0;
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
                  aria-label={
                    picked
                      ? `Picture ${position + 1} on this card. Click to take it off.`
                      : "Add this picture to the card"
                  }
                  aria-pressed={picked}
                  className="size-full disabled:cursor-not-allowed"
                  disabled={disabled}
                  title={tile.url}
                  onClick={() => (picked ? takeOff(position) : add(tile.url))}
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
                      <span className="grid size-6 place-items-center rounded-full bg-black/60 text-[11px] font-semibold tabular-nums">
                        {position + 1}
                      </span>
                    </span>
                  ) : (
                    <span className="absolute inset-x-0 bottom-0 hidden bg-black/45 py-0.5 text-center text-[10px] text-white group-hover:block">
                      Add
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
          onClick={clearAll}
        >
          No pictures
        </button>
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-40"
          disabled={disabled}
          onClick={() => setLinkOpen((open) => !open)}
        >
          {linkOpen ? "Hide the link field" : "Add a picture by address"}
        </button>
      </div>

      {linkOpen ? (
        <form
          className="space-y-1"
          onSubmit={(event) => {
            event.preventDefault();

            if (add(linkDraft)) setLinkDraft("");
          }}
        >
          <div className="flex gap-1.5">
            <input
              aria-label="Picture address"
              className={FIELD}
              disabled={disabled}
              inputMode="url"
              placeholder="https://…"
              spellCheck={false}
              value={linkDraft}
              onChange={(event) => setLinkDraft(event.target.value)}
            />
            <button
              type="submit"
              className="h-[30px] shrink-0 rounded-lg border border-border px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40"
              disabled={disabled || linkDraft.trim().length === 0}
            >
              Add
            </button>
          </div>
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            A public https:// address. WhatsApp fetches it from its own server,
            so it cannot be a file on this computer.
          </p>
        </form>
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