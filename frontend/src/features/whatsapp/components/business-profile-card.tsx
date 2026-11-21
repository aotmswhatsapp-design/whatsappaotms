"use client";

import * as React from "react";
import Link from "next/link";
import {
  BadgeCheck,
  ExternalLink,
  Globe,
  Info,
  Mail,
  MapPin,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import {
  ApiError,
  fetchBusinessProfile,
  type BusinessProfileFacts,
  type BusinessProfilePayload,
} from "./api";

/**
 * What a customer sees when they open the chat, read from Meta.
 *
 * Deliberately read-only. Meta owns every field here, so the only honest
 * action is to show the current values and say where they are edited; a form
 * that posted them back would fail for reasons this card cannot fix.
 */
export function BusinessProfileCard() {
  const [payload, setPayload] = React.useState<BusinessProfilePayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  // The call needs the browser's session token, so it cannot happen during
  // prerender. State moves only inside the promise callbacks.
  React.useEffect(() => {
    let active = true;

    fetchBusinessProfile()
      .then((next) => {
        if (!active) return;
        setPayload(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Could not read the WhatsApp profile.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  function retry() {
    setLoading(true);
    setError(null);
    setAttempt((value) => value + 1);
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">
            WhatsApp business profile
          </h2>
          <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            What a customer sees before they send a message. Meta owns these
            fields, so they are read from Graph for the connected number rather
            than stored here.
          </p>
        </div>
        {payload && payload.connected ? (
          <SourceTag live={payload.live} />
        ) : null}
      </div>

      <div className="px-5 py-4">
        {loading ? (
          <ProfileSkeleton />
        ) : error ? (
          <ReadFailure message={error} onRetry={retry} />
        ) : payload && !payload.connected ? (
          <NotConnected />
        ) : payload?.profile ? (
          <Preview facts={payload.profile} problem={payload.problem} />
        ) : null}
      </div>
    </section>
  );
}

/** Whether these values were read just now or only the stored half is left. */
function SourceTag({ live }: { live: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      <span
        aria-hidden="true"
        className={
          live
            ? "size-1.5 rounded-full bg-lime"
            : "size-1.5 rounded-full bg-muted-foreground/50"
        }
      />
      {live ? "Live from Meta" : "Stored copy"}
    </span>
  );
}

function Preview({
  facts,
  problem,
}: {
  facts: BusinessProfileFacts;
  problem: string | null;
}) {
  const name = facts.verifiedName ?? facts.displayPhoneNumber ?? "This number";
  const subtitle = [facts.displayPhoneNumber, category(facts.vertical)]
    .filter(Boolean)
    .join(" · ");
  const filled = [
    facts.about,
    facts.description,
    facts.address,
    facts.email,
    ...facts.websites,
  ].some(Boolean);

  return (
    <div className="space-y-4">
      {problem ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-warning">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {problem} The name, number and rating below are the copy stored when
            you connected; the rest is missing until a read succeeds.
          </span>
        </p>
      ) : null}

      <div className="rounded-xl border border-border bg-background p-4">
        <div className="flex items-center gap-3">
          <Avatar facts={facts} name={name} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[15px] leading-tight font-semibold text-foreground">
              <span className="truncate">{name}</span>
              {facts.verifiedName ? (
                <BadgeCheck
                  aria-label="Verified business name"
                  className="size-4 shrink-0 text-brand"
                />
              ) : null}
            </p>
            {subtitle ? (
              <p className="mt-1 truncate text-[12.5px] text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>

        {filled ? (
          <dl className="mt-4 space-y-3 border-t border-border pt-4">
            {facts.about ? <Row label="About">{facts.about}</Row> : null}
            {facts.description ? (
              <Row label="Description">{facts.description}</Row>
            ) : null}
            {facts.address ? (
              <Row label="Address">
                <span className="flex items-start gap-2">
                  <MapPin aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  {facts.address}
                </span>
              </Row>
            ) : null}
            {facts.email ? (
              <Row label="Email">
                <a
                  className="flex items-center gap-2 text-brand underline-offset-4 hover:underline"
                  href={`mailto:${facts.email}`}
                >
                  <Mail aria-hidden="true" className="size-3.5 shrink-0" />
                  {facts.email}
                </a>
              </Row>
            ) : null}
            {facts.websites.length ? (
              <Row label="Website">
                <span className="space-y-1">
                  {facts.websites.map((site) => (
                    <a
                      key={site}
                      className="flex items-center gap-2 text-brand underline-offset-4 hover:underline"
                      href={site}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      <Globe aria-hidden="true" className="size-3.5 shrink-0" />
                      <span className="truncate">{prettyUrl(site)}</span>
                      <ExternalLink aria-hidden="true" className="size-3 shrink-0 opacity-60" />
                    </a>
                  ))}
                </span>
              </Row>
            ) : null}
            {facts.qualityRating ? (
              <Row label="Quality rating">{quality(facts.qualityRating)}</Row>
            ) : null}
          </dl>
        ) : (
          <p className="mt-4 border-t border-border pt-4 text-[13px] leading-relaxed text-muted-foreground">
            {problem
              ? "The live half of the profile could not be read, so about, description, address, email and website are not shown here."
              : "Meta holds no about text, description, address, email or website for this number yet. Customers see only the name and the number."}
          </p>
        )}
      </div>

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Meta owns this profile: it is edited in WhatsApp Manager, not from here.
        Reconnecting the number in{" "}
        <Link className="text-brand underline-offset-4 hover:underline" href="/workspace/whatsapp">
          WhatsApp settings
        </Link>{" "}
        refreshes the name and quality rating stored on this side.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-[13px] break-words whitespace-pre-wrap text-foreground">
        {children}
      </dd>
    </div>
  );
}

/** The picture Meta hosts, or initials — a broken image would be worse. */
function Avatar({ facts, name }: { facts: BusinessProfileFacts; name: string }) {
  if (facts.pictureUrl) {
    return (
      // Meta serves this URL from its own CDN; next/image would need a remote
      // pattern for an origin we do not control.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt=""
        className="size-14 shrink-0 rounded-full border border-border object-cover"
        src={facts.pictureUrl}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-soft text-[15px] font-semibold text-brand"
    >
      {initials(name)}
    </span>
  );
}

function ProfileSkeleton() {
  return (
    <div aria-busy="true" className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="size-14 shrink-0 animate-pulse rounded-full bg-secondary" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-40 animate-pulse rounded bg-secondary" />
          <div className="h-3 w-28 animate-pulse rounded bg-secondary" />
        </div>
      </div>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="h-3 animate-pulse rounded bg-secondary"
          style={{ width: `${70 - row * 12}%` }}
        />
      ))}
    </div>
  );
}

function ReadFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-background px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-foreground">
          Could not read the WhatsApp profile
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          {message}
        </p>
      </div>
      <Button onClick={onRetry} size="sm" variant="outline">
        <RefreshCw aria-hidden="true" className="size-3.5" />
        Try again
      </Button>
    </div>
  );
}

function NotConnected() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3">
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        No WhatsApp number is connected yet, so there is no profile to show.
      </p>
      <Button asChild size="sm" variant="brand">
        <Link href="/workspace/whatsapp">Connect a number</Link>
      </Button>
    </div>
  );
}

/** `RETAIL` → `Retail`; Meta sends the category as a bare enum. */
function category(vertical: string | null): string | null {
  if (!vertical) return null;
  const words = vertical.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Meta's one-word verdict, made readable without pretending it is a score. */
function quality(rating: string): string {
  const words = rating.toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The host and path only: a full URL wraps onto three lines at this width. */
function prettyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2);

  if (!parts.length) return "WA";

  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}
