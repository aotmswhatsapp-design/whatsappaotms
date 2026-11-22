/**
 * Time, size and name formatting for the inbox.
 *
 * Everything here is shown after a client fetch, so the locale is the browser's
 * and there is no server/client hydration gap.
 */

import type { InboxMessage } from "./api";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** List-row timestamp: recent activity reads better as a duration. */
export function relativeTime(iso: string, now = Date.now()): string {
  const at = new Date(iso).getTime();
  const delta = Math.max(0, now - at);

  if (delta < MINUTE) return "now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  if (delta < 7 * DAY) {
    return new Date(at).toLocaleDateString(undefined, { weekday: "short" });
  }

  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** Bubble timestamp inside the open thread. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Local calendar day, used to group messages. */
export function dayKey(iso: string): string {
  const date = new Date(iso);

  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - DAY);

  if (dayKey(iso) === dayKey(today.toISOString())) return "Today";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/**
 * `23:59:58` — the reply window as a countdown, or null once it has closed.
 *
 * The window opens with the customer's last message, so the digits run from
 * 24:00:00 down to zero and then the conversation can only be noted. Capped at
 * a day so a clock-skewed timestamp cannot print 25 hours.
 */
export function windowCountdown(
  lastInboundAt: string | null,
  now = Date.now(),
): string | null {
  if (!lastInboundAt) return null;

  const remaining = Math.min(DAY, new Date(lastInboundAt).getTime() + DAY - now);

  if (remaining <= 0) return null;

  const total = Math.floor(remaining / 1000);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

export function formatBytes(size: number | null): string {
  if (!size || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Two letters for an avatar, never empty. */
export function initials(name: string | null, fallback: string): string {
  const source = (name ?? "").trim() || fallback;

  const words = source.split(/\s+/).filter(Boolean);

  if (/^\+?\d/.test(source) && words.length === 1) {
    return source.replace(/\D/g, "").slice(-2) || "?";
  }

  if (words.length >= 2) {
    return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}

/** `+91 90000 12345` from digits, when Meta only gave us `919000012345`. */
export function displayPhone(waId: string): string {
  const digits = waId.replace(/\D/g, "");

  if (digits.length <= 10) return waId;

  return `+${digits.slice(0, digits.length - 10)} ${digits.slice(-10)}`;
}

/**
 * One line for a message that may carry no text at all.
 *
 * A quote block and the composer's quote chip both show the message being
 * answered, and a location or a sticker has no body — without this they would
 * quote a blank rectangle.
 */
export function messageSnippet(message: InboxMessage): string {
  const body = message.body?.trim();

  if (body) return body;
  if (message.payload?.kind === "location") {
    return message.payload.name ?? message.payload.address ?? "Location";
  }
  if (message.payload?.kind === "contacts") {
    return message.payload.contacts.map((card) => card.name).join(", ");
  }
  if (message.media) return message.media.name ?? "[attachment]";

  return "[message]";
}
