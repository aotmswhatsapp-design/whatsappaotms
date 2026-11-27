"use client";

import * as React from "react";
import {
  CircleAlert,
  FileText,
  ImageOff,
  Loader2,
  MapPin,
  MousePointerClick,
  UserRound,
} from "lucide-react";

import {
  ApiError,
  fetchMedia,
  type InboxMessage,
  type MediaLink,
  type MessageKind,
} from "../api";
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

  if (message.kind === "STICKER") {
    return (
      <a href={link.url} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={link.url}
          alt={link.name ?? "Sticker"}
          className="max-h-36 w-auto max-w-full"
          loading="lazy"
        />
      </a>
    );
  }

  if (message.kind === "IMAGE") {
    return (
      <a href={link.url} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={link.url}
          alt={link.name ?? "Image attachment"}
          className="max-h-64 w-auto max-w-full rounded-lg"
          loading="lazy"
        />
      </a>
    );
  }

  if (message.kind === "AUDIO") {
    return <audio controls preload="none" src={link.url} className="w-56 max-w-full" />;
  }

  if (message.kind === "VIDEO") {
    return (
      <video
        controls
        preload="none"
        src={link.url}
        className="max-h-64 w-full max-w-[17rem] rounded-lg"
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
        <span className="block truncate text-[12px] font-medium">
          {link.name ?? message.media?.name ?? "Document"}
        </span>
        <span className="block text-[10.5px] text-muted-foreground">
          {formatBytes(message.media?.size ?? null) || "Download"}
        </span>
      </span>
    </a>
  );
}

/**
 * The kinds that arrive with nothing to fetch.
 *
 * A location, a contact card or a button reply has no media row, and the bubble
 * only rendered `MessageMedia` — so those messages showed up as empty bubbles.
 * WhatsApp sends a poll as an interactive message too, which is why that case
 * shares the label rather than pretending the poll is gone.
 */
const LABELS: Partial<
  Record<MessageKind, { label: string; icon: React.ReactNode }>
> = {
  LOCATION: {
    label: "Location",
    icon: <MapPin aria-hidden="true" className="size-3.5 shrink-0" />,
  },
  CONTACTS: {
    label: "Contact card",
    icon: <UserRound aria-hidden="true" className="size-3.5 shrink-0" />,
  },
  BUTTON: {
    label: "Button reply",
    icon: <MousePointerClick aria-hidden="true" className="size-3.5 shrink-0" />,
  },
  INTERACTIVE: {
    label: "Interactive reply",
    icon: <MousePointerClick aria-hidden="true" className="size-3.5 shrink-0" />,
  },
  UNSUPPORTED: {
    label: "This message type can't be shown here",
    icon: <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />,
  },
  MEDIA_PENDING: {
    label: "This message's media was not shared.",
    icon: <ImageOff aria-hidden="true" className="size-3.5 shrink-0" />,
  },
};

/** A one-line label for the kinds above, so none of them renders blank. */
export function MessageLabel({ kind }: { kind: MessageKind }) {
  const entry = LABELS[kind];

  if (!entry) return null;

  return (
    <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      {entry.icon}
      {entry.label}
    </p>
  );
}

/**
 * The contents of a pin or a contact card.
 *
 * The label alone said "Location" over a bubble that never showed where, and
 * "Contact card" over one that never showed who. Both directions carry the
 * same payload shape, so a sent pin and a received one read alike.
 */
export function MessageContents({ message }: { message: InboxMessage }) {
  const payload = message.payload;

  if (payload?.kind === "location") {
    const { latitude, longitude, name, address } = payload;
    const coordinates = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

    return (
      <div className="mb-1 space-y-0.5">
        {name ? (
          <p className="text-[12.5px] leading-snug font-semibold">{name}</p>
        ) : null}
        {address ? (
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            {address}
          </p>
        ) : null}
        <a
          href={`https://maps.google.com/?q=${latitude},${longitude}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-brand underline-offset-2 hover:underline"
        >
          <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
          {coordinates}
        </a>
      </div>
    );
  }

  if (payload?.kind === "contacts") {
    return (
      <div className="mb-1 space-y-1.5">
        {payload.contacts.map((card, index) => (
          <div
            key={`${card.name}-${index}`}
            className="rounded-lg border border-border/70 bg-card px-2.5 py-1.5"
          >
            <p className="flex items-center gap-1.5 text-[12.5px] leading-snug font-semibold">
              <UserRound aria-hidden="true" className="size-3.5 shrink-0" />
              {card.name}
            </p>
            {card.organization ? (
              <p className="text-[11px] text-muted-foreground">
                {card.organization}
              </p>
            ) : null}
            {card.phones.map((phone) => (
              <a
                key={phone}
                href={`tel:${phone.replace(/[^+\d]/g, "")}`}
                className="block truncate text-[11.5px] text-brand underline-offset-2 hover:underline"
              >
                {phone}
              </a>
            ))}
            {card.emails.map((email) => (
              <a
                key={email}
                href={`mailto:${email}`}
                className="block truncate text-[11.5px] text-brand underline-offset-2 hover:underline"
              >
                {email}
              </a>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return null;
}
