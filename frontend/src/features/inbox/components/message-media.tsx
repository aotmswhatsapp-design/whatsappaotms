"use client";

import * as React from "react";
import { FileText, Loader2 } from "lucide-react";

import { ApiError, fetchMedia, type InboxMessage, type MediaLink } from "../api";
import { formatBytes } from "../format";

/**
 * One attachment.
 *
 * The URL is fetched on mount because signed links expire in five minutes; an
 * `<img src>` pointed at a stored URL would work once and then fail silently.
 */
export function MessageMedia({ message }: { message: InboxMessage }) {
  const available = message.media?.available ?? false;

  const [link, setLink] = React.useState<MediaLink | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!available) return;

    let active = true;

    fetchMedia(message.id)
      .then((next) => {
        if (active) setLink(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFailure(
          error instanceof ApiError ? error.message : "Could not load the file.",
        );
      });

    return () => {
      active = false;
    };
  }, [message.id, available]);

  if (!available) {
    return (
      <p className="text-[13px] text-muted-foreground">
        {message.media?.name ?? "This attachment"} is no longer available from
        WhatsApp.
      </p>
    );
  }

  if (failure) {
    return <p className="text-[13px] text-destructive">{failure}</p>;
  }

  if (!link) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        Loading file…
      </p>
    );
  }

  if (message.kind === "IMAGE" || message.kind === "STICKER") {
    return (
      <a href={link.url} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={link.url}
          alt={link.name ?? "Image attachment"}
          className="max-h-72 w-auto max-w-full rounded-lg"
          loading="lazy"
        />
      </a>
    );
  }

  if (message.kind === "AUDIO") {
    return <audio controls preload="none" src={link.url} className="w-64 max-w-full" />;
  }

  if (message.kind === "VIDEO") {
    return (
      <video
        controls
        preload="none"
        src={link.url}
        className="max-h-72 w-full max-w-xs rounded-lg"
      />
    );
  }

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      className="flex max-w-xs items-center gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-2 text-foreground transition-colors hover:bg-accent"
    >
      <FileText aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">
          {link.name ?? message.media?.name ?? "Document"}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {formatBytes(message.media?.size ?? null) || "Download"}
        </span>
      </span>
    </a>
  );
}
