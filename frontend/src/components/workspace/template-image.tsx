"use client";

import * as React from "react";
import { ImageIcon } from "lucide-react";

import { request } from "@/lib/api/http";
import { cn } from "@/lib/utils";

interface SignedLink {
  url: string;
  mime: string | null;
}

/**
 * The server signs a link for five minutes. Refreshing a little sooner means a
 * card is never painted with a URL that expires mid-download.
 */
const CACHE_TTL_MS = 240_000;

/**
 * One link per template, shared by every place the image appears — the card,
 * the inbox panel, a detail screen — so a re-render or a remount costs nothing.
 */
const links = new Map<string, { url: string; expires: number }>();
const pending = new Map<string, Promise<string>>();

function signedUrl(templateId: string, fresh: boolean): Promise<string> {
  const cached = links.get(templateId);

  if (!fresh && cached && cached.expires > Date.now()) {
    return Promise.resolve(cached.url);
  }

  const inflight = pending.get(templateId);

  if (!fresh && inflight) return inflight;

  const load = request<SignedLink>(`/v1/templates/${templateId}/media`, {
    method: "GET",
  })
    .then((link) => {
      links.set(templateId, {
        url: link.url,
        expires: Date.now() + CACHE_TTL_MS,
      });

      return link.url;
    })
    .finally(() => {
      pending.delete(templateId);
    });

  pending.set(templateId, load);

  return load;
}

/**
 * A template's header sample, fetched as a short-lived signed URL when it is
 * about to be shown.
 *
 * The URL is never stored in the row: it dies in five minutes, and a cached one
 * would render once and then fail silently. When the image cannot be fetched —
 * the file was removed, storage is down, the row belongs to another workspace —
 * the box keeps its WhatsApp grey and reports the failure in a tooltip, so a
 * card still looks like a card instead of collapsing.
 */
export function TemplateImage({
  templateId,
  hasMedia,
  alt,
  className,
}: {
  templateId: string;
  hasMedia: boolean;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (!hasMedia) return;

    let active = true;

    signedUrl(templateId, attempt > 0)
      .then((next) => {
        if (!active) return;

        setUrl(next);
        setFailed(false);
      })
      .catch(() => {
        if (!active) return;

        setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [templateId, hasMedia, attempt]);

  if (!hasMedia || failed) {
    return (
      <div
        className={cn("grid place-items-center bg-[#d1d7db]", className)}
        title={failed ? "The header image could not be loaded." : undefined}
      >
        <ImageIcon aria-hidden="true" className="size-4 text-[#5b6b73]" />
      </div>
    );
  }

  if (!url) {
    return (
      <div
        aria-hidden="true"
        className={cn("animate-pulse bg-[#d1d7db]", className)}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt}
      className={cn("w-full object-cover", className)}
      onError={() => {
        // An expired link is the likeliest cause, so retry once with a fresh
        // signature before giving up on the image.
        setUrl(null);

        if (attempt === 0) {
          setAttempt(1);
        } else {
          setFailed(true);
        }
      }}
      src={url}
    />
  );
}
