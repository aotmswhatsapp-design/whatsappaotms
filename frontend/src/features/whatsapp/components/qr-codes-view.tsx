"use client";

import * as React from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  QrCode as QrCodeIcon,
  RefreshCw,
  Trash,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/workspace/empty-state";
import { cn } from "@/lib/utils";

import {
  ApiError,
  createQrCode,
  deleteQrCode,
  fetchQrCodes,
  updateQrCode,
  type QrCode,
  type QrCodeList,
  type QrFormat,
} from "./api";

/** Meta's ceiling on the message a scan prefills. The API enforces it too. */
const MAX_MESSAGE = 140;

const FORMATS: { value: QrFormat; label: string }[] = [
  { value: "SVG", label: "SVG — best for print" },
  { value: "PNG", label: "PNG — best for screens" },
];

/**
 * The number's QR codes and short links, as Meta holds them.
 *
 * Every operation here is a Graph call, so the list is not cached anywhere: a
 * code deleted in WhatsApp Manager disappears from this screen on the next
 * load, and a code created here is live the moment Meta answers. Meta reports
 * no scan statistics, so this screen deliberately shows none.
 */
export function QrCodesView() {
  const [list, setList] = React.useState<QrCodeList | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;

    fetchQrCodes()
      .then((next) => {
        if (!active) return;
        setList(next);
        setLoadError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setLoadError(readError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  function reload() {
    setLoading(true);
    setLoadError(null);
    setAttempt((count) => count + 1);
  }

  if (loading && !list) {
    return (
      <div className="grid h-64 place-items-center rounded-xl border border-border bg-card">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError && !list) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground">
          The QR codes could not be read
        </h2>
        <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
          {loadError}
        </p>
        <Button className="mt-4" onClick={reload} type="button" variant="outline">
          <RefreshCw />
          Try again
        </Button>
      </div>
    );
  }

  if (!list || !list.connected) {
    return (
      <EmptyState
        action={
          <Button asChild variant="brand">
            <Link href="/workspace/whatsapp">Connect WhatsApp</Link>
          </Button>
        }
        description="QR codes and short links belong to a WhatsApp number, so there is nothing to create until one is connected."
        icon={QrCodeIcon}
        title="Connect a WhatsApp number"
      />
    );
  }

  const atLimit = list.codes.length >= list.limit;

  return (
    <div className="space-y-6">
      <CreateCard
        atLimit={atLimit}
        onCreated={(created) => {
          setList((current) =>
            current
              ? { ...current, codes: [created, ...current.codes] }
              : current,
          );
        }}
      />

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            Active codes
          </h2>
          <p className="text-[12.5px] tabular-nums text-muted-foreground">
            {list.codes.length} of {list.limit.toLocaleString()} used
          </p>
        </div>

        {loadError ? (
          <p
            className="mt-3 rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12.5px] leading-relaxed text-foreground"
            role="alert"
          >
            {loadError}
          </p>
        ) : null}

        {list.codes.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              description="Create the first one above and it becomes usable immediately — print it, or paste the short link into a bio or an email signature."
              icon={QrCodeIcon}
              title="No codes yet"
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {list.codes.map((facts) => (
              <QrCard
                key={facts.code}
                facts={facts}
                onDeleted={(code) =>
                  setList((current) =>
                    current
                      ? {
                          ...current,
                          codes: current.codes.filter((row) => row.code !== code),
                        }
                      : current,
                  )
                }
                onUpdated={(next) =>
                  setList((current) =>
                    current
                      ? {
                          ...current,
                          codes: current.codes.map((row) =>
                            row.code === next.code ? next : row,
                          ),
                        }
                      : current,
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/*
        Stated on the page rather than left to be discovered: Meta keeps no
        scan data for these, so there are no numbers to show, and a screen that
        silently omits a metric reads as a screen that forgot it.
      */}
      <p className="rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
        Meta does not report how often a code is scanned or a link is opened —
        it limits what it logs for privacy — so there are no scan figures on
        this page.
      </p>
    </div>
  );
}

/** Creating is one POST; the reply already carries the code and its image. */
function CreateCard({
  atLimit,
  onCreated,
}: {
  atLimit: boolean;
  onCreated: (created: QrCode) => void;
}) {
  const toast = useToast();
  const [message, setMessage] = React.useState("");
  const [format, setFormat] = React.useState<QrFormat>("SVG");
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const trimmed = message.trim();
  const ready = trimmed.length > 0 && !creating && !atLimit;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;

    setCreating(true);
    setError(null);

    try {
      const { code } = await createQrCode({
        prefilledMessage: trimmed,
        format,
      });

      onCreated(code);
      setMessage("");
      toast.push({
        tone: "success",
        title: "QR code created",
        description: "It works now — print the image or share the short link.",
      });
    } catch (caught: unknown) {
      setError(readError(caught));
    } finally {
      setCreating(false);
    }
  }

  return (
    <form
      className="rounded-xl border border-border bg-card p-5"
      onSubmit={submit}
    >
      <h2 className="text-base font-semibold text-foreground">
        Create a QR code
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        Scanning the code opens a chat with your number and puts this message in
        the customer&apos;s box, ready to send.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_13rem]">
        <label className="block min-w-0">
          <span className="text-xs font-medium text-muted-foreground">
            Prefilled message
          </span>
          <textarea
            className="mt-1.5 min-h-20 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-ring/30"
            disabled={creating || atLimit}
            maxLength={MAX_MESSAGE}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Hi, I saw your code and I would like to know more"
            rows={2}
            value={message}
          />
          <span className="mt-1 flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground">
            <span>
              Editable later without changing the code or the link.
            </span>
            <span className={cn("shrink-0 tabular-nums", trimmed.length >= MAX_MESSAGE && "text-destructive")}>
              {trimmed.length}/{MAX_MESSAGE}
            </span>
          </span>
        </label>

        <label className="block min-w-0">
          <span className="text-xs font-medium text-muted-foreground">
            Image format
          </span>
          <select
            className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-ring/30"
            disabled={creating || atLimit}
            onChange={(event) => setFormat(event.target.value as QrFormat)}
            value={format}
          >
            {FORMATS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Fixed when the image is made.
          </span>
        </label>
      </div>

      {error ? (
        <p
          className="mt-4 rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12.5px] leading-relaxed text-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button disabled={!ready} type="submit" variant="brand">
          {creating ? <Loader2 className="animate-spin" /> : <Plus />}
          {creating ? "Creating…" : "Create QR code"}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          {atLimit
            ? "This number has reached Meta's limit of 2,000 codes. Delete one to make room."
            : "One Graph call. Meta returns the image at the same time."}
        </p>
      </div>
    </form>
  );
}

/** One code: the image, the message it carries, and the link it resolves to. */
function QrCard({
  facts,
  onUpdated,
  onDeleted,
}: {
  facts: QrCode;
  onUpdated: (next: QrCode) => void;
  onDeleted: (code: string) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(facts.prefilledMessage);
  const [saving, setSaving] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || saving) return;

    setSaving(true);
    setError(null);

    try {
      const { code } = await updateQrCode(facts.code, message);

      // Meta's update reply has no image, and the image cannot have changed:
      // the code is the same. Keeping the one on screen avoids a blank card.
      onUpdated({ ...code, imageUrl: code.imageUrl ?? facts.imageUrl });
      setEditing(false);
      toast.push({
        tone: "success",
        title: "Message updated",
        description: "The printed code and the short link still work.",
      });
    } catch (caught: unknown) {
      setError(readError(caught));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setError(null);

    try {
      await deleteQrCode(facts.code);
      onDeleted(facts.code);
      toast.push({
        tone: "success",
        title: "QR code deleted",
        description: "Anyone scanning it now sees that it has expired.",
      });
    } catch (caught: unknown) {
      setError(readError(caught));
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <QrImage facts={facts} />

        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={save}>
              <label className="block">
                <span className="text-[12.5px] font-medium text-muted-foreground">
                  Prefilled message
                </span>
                <textarea
                  className="mt-1.5 min-h-16 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-ring/30"
                  disabled={saving}
                  maxLength={MAX_MESSAGE}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={2}
                  value={draft}
                />
                <span className="mt-1 block text-right text-[11px] tabular-nums text-muted-foreground">
                  {draft.trim().length}/{MAX_MESSAGE}
                </span>
              </label>

              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  disabled={saving || draft.trim().length === 0}
                  size="sm"
                  type="submit"
                  variant="brand"
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Check />}
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button
                  disabled={saving}
                  onClick={() => {
                    setEditing(false);
                    setDraft(facts.prefilledMessage);
                    setError(null);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <blockquote className="text-sm leading-relaxed text-foreground">
              {facts.prefilledMessage || (
                <span className="text-muted-foreground italic">
                  No prefilled message
                </span>
              )}
            </blockquote>
          )}

          <div className="mt-3">
            <LinkRow value={facts.shortLink} />
          </div>

          <p className="mt-2 font-mono text-[11px] break-all text-muted-foreground">
            Code {facts.code}
          </p>
        </div>
      </div>

      {error ? (
        <p
          className="mt-3 rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12.5px] leading-relaxed text-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {confirming ? (
          <>
            <p className="mr-auto text-[12px] text-foreground">
              Delete this code? Scans of it stop working.
            </p>
            <Button
              disabled={deleting}
              onClick={() => void remove()}
              size="sm"
              type="button"
              variant="destructive"
            >
              {deleting ? <Loader2 className="animate-spin" /> : <Trash />}
              {deleting ? "Deleting…" : "Delete"}
            </Button>
            <Button
              disabled={deleting}
              onClick={() => setConfirming(false)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Keep
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => {
                setDraft(facts.prefilledMessage);
                setEditing(true);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <Pencil />
              Edit message
            </Button>
            {facts.imageUrl ? (
              <Button asChild size="sm" variant="ghost">
                <a href={facts.imageUrl} rel="noreferrer" target="_blank">
                  <ExternalLink />
                  Open image
                </a>
              </Button>
            ) : null}
            <Button
              className="ml-auto"
              onClick={() => setConfirming(true)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trash />
              Delete
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Meta hosts the image on its own CDN, so `next/image` would need a remote
 * pattern for an origin we do not control — and it buys nothing for a static
 * SVG that is displayed at one size.
 */
function QrImage({ facts }: { facts: QrCode }) {
  if (!facts.imageUrl) {
    return (
      <div className="grid size-28 shrink-0 place-items-center rounded-lg border border-dashed border-border bg-secondary p-2 text-center text-[11px] leading-tight text-muted-foreground">
        No image returned
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={`QR code for the message: ${facts.prefilledMessage || facts.code}`}
      className="size-28 shrink-0 rounded-lg border border-border bg-card object-contain p-1.5"
      height={112}
      src={facts.imageUrl}
      width={112}
    />
  );
}

/** The short link, with copy that says whether it worked. */
function LinkRow({ value }: { value: string }) {
  const toast = useToast();
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast.push({
        tone: "error",
        title: "Could not copy",
        description: "Select the link and copy it by hand.",
        duration: 6_000,
      });
    }
  }

  return (
    <div className="flex items-stretch gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-secondary px-2.5 py-1.5 font-mono text-[12px] text-foreground">
        {value}
      </code>
      <button
        aria-label="Copy short link"
        className="grid w-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-border bg-card text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => void copy()}
        type="button"
      >
        {copied ? (
          <Check aria-hidden="true" className="size-4 text-lime" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
      </button>
    </div>
  );
}

function readError(caught: unknown): string {
  return caught instanceof ApiError
    ? caught.message
    : "The request failed. Check the API is running and try again.";
}

