import type {
  ConversationStatus,
  FollowUpStatus,
  LeadInterest,
  MessageDirection,
  MessageKind,
  MessageStatus,
  Prisma,
} from "@prisma/client";

import type { BotCard } from "../bots/bot.card";
import { snapshotIn } from "../bots/bot.snapshot";

/**
 * The shapes the browser consumes, plus the Prisma selections that feed them.
 *
 * Dates leave as ISO strings so the client never has to guess a timezone, and
 * media arrives as a descriptor rather than a URL: a URL is short-lived, so the
 * `<img>` asks for a fresh one when it renders.
 */

/** WhatsApp's customer-service window, measured from the last inbound message. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

/** The kinds that actually carry a file. A tapped button does not. */
const MEDIA_KINDS: ReadonlySet<MessageKind> = new Set([
  "IMAGE",
  "DOCUMENT",
  "AUDIO",
  "VIDEO",
  "STICKER",
]);

export const CONVERSATION_SELECT = {
  id: true,
  status: true,
  interest: true,
  interestScore: true,
  interestReason: true,
  interestAt: true,
  /**
   * The one open follow-up, if any. Served by the partial unique index on
   * `follow_up_tasks (conversation_id) where status = 'OPEN'`, so a hundred
   * rows still cost one query.
   */
  followUpTasks: {
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, title: true, dueAt: true, status: true },
  },
  aiPausedAt: true,
  aiPauseReason: true,
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
  agent: {
    select: { id: true, name: true },
  },
} satisfies Prisma.ConversationSelect;

export const MESSAGE_SELECT = {
  id: true,
  wamid: true,
  direction: true,
  kind: true,
  imported: true,
  agentId: true,
  status: true,
  body: true,
  templateName: true,
  templateLanguage: true,
  tapTarget: true,
  mediaId: true,
  mediaMime: true,
  mediaName: true,
  mediaSize: true,
  mediaPath: true,
  errorReason: true,
  contextWamid: true,
  payload: true,
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
  /** What the customer's words said about buying. */
  interest: LeadInterest;
  /** The evidence behind the stage, for the tooltip. */
  interestScore: number | null;
  interestReason: string | null;
  interestAt: string | null;
  /** The open follow-up, so the thread can offer it without a second read. */
  openTask: { id: string; title: string; dueAt: string | null; status: FollowUpStatus } | null;
  contact: {
    id: string;
    waId: string;
    name: string | null;
    phone: string | null;
  };
  assignedTo: { id: string; name: string | null; email: string } | null;
  /**
   * The agent that owns this thread: the one that answered it first, and the
   * only one that may answer it again. Null until an agent has replied.
   */
  agent: { id: string; name: string } | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastInboundAt: string | null;
  unreadCount: number;
  /** False once 24 hours have passed; the composer is disabled then. */
  windowOpen: boolean;
  /**
   * Set when a person replied, or when the agent handed the thread over. The
   * thread header says who stopped it and offers resume.
   */
  aiPausedAt: string | null;
  aiPauseReason: string | null;
}

/** One card from a contact message, as the bubble draws it. */
export interface ContactCardEntry {
  name: string;
  phones: string[];
  emails: string[];
  organization: string | null;
}

/** The contents of a kind that is neither text nor a file. */
export type MessagePayload =
  | {
      kind: "location";
      latitude: number;
      longitude: number;
      name: string | null;
      address: string | null;
    }
  | { kind: "contacts"; contacts: ContactCardEntry[] }
  | null;

export interface MessageView {
  id: string;
  direction: MessageDirection;
  kind: MessageKind;
  /** A row mirrored from the WhatsApp Business app's history. */
  imported: boolean;
  status: MessageStatus;
  body: string | null;
  /**
   * The agent that wrote it, or null for every human and campaign send. The
   * bubble's badge reads this and nothing else, so an AI reply never has to be
   * inferred from its wording.
   */
  agentId: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  errorReason: string | null;
  /**
   * Set on a template send. `name` is the approved template, and `tapTarget`
   * is the override that was sent, if any — the thread says what a customer's
   * link opened.
   */
  template: {
    name: string;
    language: string;
    tapTarget: { url: string; title: string } | null;
  } | null;
  /** Null unless the message carries a file. `available` is false when Meta gave no file. */
  media: {
    mime: string | null;
    name: string | null;
    size: number | null;
    available: boolean;
  } | null;
  /**
   * The message this one quotes or reacts to, resolved to a row id in this
   * thread. Null when it quotes nothing, or quotes something older than the
   * page of messages the thread loaded.
   */
  quotedMessageId: string | null;
  /** Contents of a location or a contact card; null for every other kind. */
  payload: MessagePayload;
  /**
   * The bot card this message carried, exactly as it was sent — the picture,
   * the header, the information and the buttons that went with it.
   *
   * Null for everything that is not a card. A card's `payload` column holds
   * the whole flow (so a tap can be routed against what the customer saw), and
   * `payload` above stays null for it: the bubble draws this card instead.
   */
  card: BotCard | null;
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
    interest: row.interest,
    interestScore: row.interestScore,
    interestReason: row.interestReason,
    interestAt: iso(row.interestAt),
    openTask: row.followUpTasks[0]
      ? {
          id: row.followUpTasks[0].id,
          title: row.followUpTasks[0].title,
          dueAt: iso(row.followUpTasks[0].dueAt),
          status: row.followUpTasks[0].status,
        }
      : null,
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
    agent: row.agent
      ? { id: row.agent.id, name: row.agent.name }
      : null,
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastMessagePreview: row.lastMessagePreview,
    lastInboundAt: iso(row.lastInboundAt),
    unreadCount: row.unreadCount,
    windowOpen: windowOpen(row.lastInboundAt),
    aiPausedAt: iso(row.aiPausedAt),
    aiPauseReason: row.aiPauseReason,
  };
}

export function messageView(
  row: MessageSource,
  /** wamid → row id, so a quote resolves to a message the thread holds. */
  byWamid?: Map<string, string>,
): MessageView {
  return {
    id: row.id,
    direction: row.direction,
    kind: row.kind,
    imported: row.imported,
    status: row.status,
    body: row.body,
    agentId: row.agentId,
    createdAt: row.createdAt.toISOString(),
    sentAt: iso(row.sentAt),
    deliveredAt: iso(row.deliveredAt),
    readAt: iso(row.readAt),
    errorReason: row.errorReason,
    template: templateOf(row),
    // A location, a contact card or a tapped button is not an attachment;
    // describing it as one makes the bubble claim the file is gone.
    media: MEDIA_KINDS.has(row.kind)
      ? {
          mime: row.mediaMime,
          name: row.mediaName,
          size: row.mediaSize,
          // A row stored before media download existed can still ask Meta.
          available: Boolean(row.mediaId || row.mediaPath),
        }
      : null,
    quotedMessageId: row.contextWamid
      ? (byWamid?.get(row.contextWamid) ?? null)
      : null,
    payload: payloadView(row.kind, row.payload),
    card: cardOf(row.payload),
  };
}

/**
 * The card a stored snapshot names.
 *
 * Read with `snapshotIn` — the same reader that routes the customer's tap — so
 * the thread draws the card the buttons were sent with, not a newer edit of
 * it. The column holds the whole flow; the bubble needs only the one card.
 */
function cardOf(raw: Prisma.JsonValue): BotCard | null {
  const snapshot = snapshotIn(raw);

  return snapshot?.flow.cards.find((card) => card.id === snapshot.cardId) ?? null;
}

/** A location and a contact card are read back as the shape the bubble draws. */
function payloadView(
  kind: MessageKind,
  raw: Prisma.JsonValue,
): MessagePayload {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const value = raw as Record<string, unknown>;

  if (kind === "LOCATION") {
    const latitude = typeof value.latitude === "number" ? value.latitude : null;
    const longitude = typeof value.longitude === "number" ? value.longitude : null;

    if (latitude === null || longitude === null) return null;

    return {
      kind: "location",
      latitude,
      longitude,
      name: typeof value.name === "string" ? value.name : null,
      address: typeof value.address === "string" ? value.address : null,
    };
  }

  if (kind === "CONTACTS" && Array.isArray(value.contacts)) {
    const contacts = value.contacts
      .filter((row): row is Record<string, unknown> =>
        row !== null && typeof row === "object" && !Array.isArray(row),
      )
      .map((row) => ({
        name: typeof row.name === "string" ? row.name : "",
        phones: stringsOf(row.phones),
        emails: stringsOf(row.emails),
        organization: typeof row.organization === "string" ? row.organization : null,
      }))
      .filter((row) => row.name.length > 0);

    return contacts.length > 0 ? { kind: "contacts", contacts } : null;
  }

  return null;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((row): row is string => typeof row === "string")
    : [];
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

/** What the list shows in place of text: the kind, or the file's own name. */
export function previewOfRow(row: {
  body: string | null;
  kind: MessageKind;
  mediaName: string | null;
}): string {
  const label = kindLabel(row.kind);
  const fallback = row.mediaName ? `${label} ${row.mediaName}` : label;

  return previewOf(row.body, fallback);
}

/** The bracket label a kind carries when it has no words of its own. */
export function kindLabel(kind: MessageKind): string {
  switch (kind) {
    case "IMAGE":
      return "[image]";
    case "DOCUMENT":
      return "[document]";
    case "AUDIO":
      return "[audio]";
    case "VIDEO":
      return "[video]";
    case "STICKER":
      return "[sticker]";
    case "LOCATION":
      return "[location]";
    case "CONTACTS":
      return "[contact card]";
    case "REACTION":
      return "[reaction]";
    case "MEDIA_PENDING":
      // The chunk said a media message exists and nothing about its type; the
      // asset either lands or it does not.
      return "[media]";
    default:
      return "[message]";
  }
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** A template row keeps Meta's name even when Meta has since deleted it. */
function templateOf(
  row: MessageSource,
): MessageView["template"] {
  if (row.kind !== "TEMPLATE" || !row.templateName) return null;

  return {
    name: row.templateName,
    language: row.templateLanguage ?? "",
    tapTarget: tapTargetOf(row.tapTarget),
  };
}

/** `tap_target` is JSON, so its shape is only as trustworthy as the writer. */
function tapTargetOf(
  value: Prisma.JsonValue,
): { url: string; title: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const { url, title } = value as Record<string, unknown>;

  return typeof url === "string" && typeof title === "string"
    ? { url, title }
    : null;
}
