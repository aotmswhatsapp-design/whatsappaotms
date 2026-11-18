import type {
  ConversationStatus,
  MessageDirection,
  MessageKind,
  MessageStatus,
  Prisma,
} from "@prisma/client";

/**
 * The shapes the browser consumes, plus the Prisma selections that feed them.
 *
 * Dates leave as ISO strings so the client never has to guess a timezone, and
 * media arrives as a descriptor rather than a URL: a URL is short-lived, so the
 * `<img>` asks for a fresh one when it renders.
 */

/** WhatsApp's customer-service window, measured from the last inbound message. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export const CONVERSATION_SELECT = {
  id: true,
  status: true,
  unreadCount: true,
  lastInboundAt: true,
  lastMessageAt: true,
  lastMessagePreview: true,
  contact: {
    select: { id: true, waId: true, profileName: true, phoneDisplay: true },
  },
  assignedTo: {
    select: { id: true, fullName: true, email: true },
  },
} satisfies Prisma.ConversationSelect;

export const MESSAGE_SELECT = {
  id: true,
  direction: true,
  kind: true,
  status: true,
  body: true,
  mediaId: true,
  mediaMime: true,
  mediaName: true,
  mediaSize: true,
  mediaPath: true,
  errorReason: true,
  sentAt: true,
  deliveredAt: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.MessageSelect;

export const NOTE_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  author: { select: { id: true, fullName: true } },
} satisfies Prisma.InternalNoteSelect;

export type ConversationSource = Prisma.ConversationGetPayload<{
  select: typeof CONVERSATION_SELECT;
}>;

export type MessageSource = Prisma.MessageGetPayload<{
  select: typeof MESSAGE_SELECT;
}>;

export type NoteSource = Prisma.InternalNoteGetPayload<{
  select: typeof NOTE_SELECT;
}>;

export interface ConversationView {
  id: string;
  status: ConversationStatus;
  contact: {
    id: string;
    waId: string;
    name: string | null;
    phone: string | null;
  };
  assignedTo: { id: string; name: string | null; email: string } | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastInboundAt: string | null;
  unreadCount: number;
  /** False once 24 hours have passed; the composer is disabled then. */
  windowOpen: boolean;
}

export interface MessageView {
  id: string;
  direction: MessageDirection;
  kind: MessageKind;
  status: MessageStatus;
  body: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  errorReason: string | null;
  /** Null for a text message. `available` is false when Meta gave no file. */
  media: {
    mime: string | null;
    name: string | null;
    size: number | null;
    available: boolean;
  } | null;
}

export interface NoteView {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null };
}

export function conversationView(row: ConversationSource): ConversationView {
  return {
    id: row.id,
    status: row.status,
    contact: {
      id: row.contact.id,
      waId: row.contact.waId,
      name: row.contact.profileName,
      phone: row.contact.phoneDisplay,
    },
    assignedTo: row.assignedTo
      ? {
          id: row.assignedTo.id,
          name: row.assignedTo.fullName,
          email: row.assignedTo.email,
        }
      : null,
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastMessagePreview: row.lastMessagePreview,
    lastInboundAt: iso(row.lastInboundAt),
    unreadCount: row.unreadCount,
    windowOpen: windowOpen(row.lastInboundAt),
  };
}

export function messageView(row: MessageSource): MessageView {
  return {
    id: row.id,
    direction: row.direction,
    kind: row.kind,
    status: row.status,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    sentAt: iso(row.sentAt),
    deliveredAt: iso(row.deliveredAt),
    readAt: iso(row.readAt),
    errorReason: row.errorReason,
    media:
      row.kind === "TEXT" || row.kind === "UNSUPPORTED"
        ? null
        : {
            mime: row.mediaMime,
            name: row.mediaName,
            size: row.mediaSize,
            // A row stored before media download existed can still ask Meta.
            available: Boolean(row.mediaId || row.mediaPath),
          },
  };
}

export function noteView(row: NoteSource): NoteView {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    author: { id: row.author.id, name: row.author.fullName },
  };
}

export function windowOpen(lastInboundAt: Date | null, now = Date.now()): boolean {
  return lastInboundAt !== null && now - lastInboundAt.getTime() < WINDOW_MS;
}

/**
 * What the agent is told when the window is shut. One string for both paths —
 * the pre-check and Meta's own 131047 — so they cannot drift apart.
 */
export const WINDOW_CLOSED_MESSAGE =
  "WhatsApp's 24-hour window has closed. Wait for the customer to write again before replying.";

/** The single sentence a list row shows for a message with no text. */
export function previewOf(body: string | null, fallback: string): string {
  const text = body?.trim() || fallback;
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
