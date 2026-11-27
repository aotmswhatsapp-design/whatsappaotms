import type { MessageKind, MessageStatus } from "@prisma/client";

import { kindOf } from "../inbox/inbox.payload";

/**
 * Meta's coexistence payloads, reduced to the shapes the inbox imports.
 *
 * Pure functions over parsed JSON, with no Prisma and no Graph, so every rule
 * can be checked against Meta's own samples. This is the part of the feature
 * where a wrong assumption is silent: a message read as inbound answers
 * itself, and a thread keyed on the wrong number lands in the wrong workspace.
 */

export interface HistoryMessage {
  wamid: string;
  direction: "INBOUND" | "OUTBOUND";
  kind: MessageKind;
  status: MessageStatus;
  body: string | null;
  mediaId: string | null;
  mediaMime: string | null;
  mediaSha256: string | null;
  errorReason: string | null;
  at: Date;
}

export interface HistoryThread {
  /** The number that received this history, so a delivery can name several. */
  phoneNumberId: string;
  /** Digits, from `thread.id` or `thread.context.wa_id`. Null when withheld. */
  phone: string | null;
  bsuid: string | null;
  username: string | null;
  messages: HistoryMessage[];
}

export interface MediaAsset {
  phoneNumberId: string;
  wamid: string;
  /** The sender's number. The business's own number marks an echo asset. */
  from: string | null;
  /** Resolved from `type`; never MEDIA_PENDING and never UNSUPPORTED. */
  kind: MessageKind;
  mediaId: string | null;
  mediaMime: string | null;
  mediaSha256: string | null;
  caption: string | null;
  at: Date;
}

export interface SyncedContact {
  phoneNumberId: string;
  phone: string | null;
  bsuid: string | null;
  fullName: string | null;
  firstName: string | null;
  action: "add" | "remove";
}

/** The highest `progress` an entry in this delivery reported for one number. */
export interface SyncProgress {
  phoneNumberId: string;
  progress: number;
}

export interface DeclinedSync {
  phoneNumberId: string;
  /** Meta's own title, not a sentence we invent. */
  sentence: string;
}

const MEDIA_KINDS: ReadonlySet<MessageKind> = new Set<MessageKind>([
  "IMAGE",
  "DOCUMENT",
  "AUDIO",
  "VIDEO",
  "STICKER",
]);

/** `history_context.status` → our delivery state. */
const HISTORY_STATUS: Record<string, MessageStatus> = {
  delivered: "DELIVERED",
  // A voice note that was played was consumed; the thread's tick has no
  // "played" state of its own.
  played: "READ",
  read: "READ",
  sent: "SENT",
  pending: "SENT",
  error: "FAILED",
};

/** Meta's code for "history sync is turned off in the WhatsApp Business app". */
const DECLINED_CODE = 2593109;

const DECLINED_TITLE =
  "History sync is turned off by the business from the WhatsApp Business app";

/** The failure sentence the thread shows for a message Meta marked failed. */
const HISTORY_FAILED =
  "The WhatsApp Business app reported this message as failed.";

type Json = Record<string, unknown>;

function objectAt(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function stringAt(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberAt(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function digits(value: string | null): string | null {
  return value ? value.replace(/\D/g, "") || null : null;
}

/** Every `entry[].changes[]` item, with its `field`, and nothing filtered. */
function changesOf(payload: unknown): { field: string | null; value: Json }[] {
  const root = objectAt(payload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];
  const found: { field: string | null; value: Json }[] = [];

  for (const entry of entries) {
    const entryObject = objectAt(entry);
    const changes = Array.isArray(entryObject?.changes)
      ? entryObject.changes
      : [];

    for (const change of changes) {
      const changeObject = objectAt(change);
      const value = objectAt(changeObject?.value);

      if (value) found.push({ field: stringAt(changeObject?.field), value });
    }
  }

  return found;
}

function phoneNumberOf(value: Json): string | null {
  return stringAt(objectAt(value.metadata)?.phone_number_id);
}

/** Seconds since the epoch as a payload string, or null when it makes no sense. */
function instantOf(value: unknown): Date | null {
  const seconds = numberAt(value);

  // An unusable timestamp cannot be placed in a 180-day history: dating it
  // "now" would sort it to the top and could open the service window.
  return seconds !== null && seconds > 0 ? new Date(seconds * 1000) : null;
}

export function historyThreads(payload: unknown): HistoryThread[] {
  const threads: HistoryThread[] = [];

  for (const change of changesOf(payload)) {
    const phoneNumberId = phoneNumberOf(change.value);
    if (!phoneNumberId) continue;

    const business = digits(
      stringAt(objectAt(change.value.metadata)?.display_phone_number),
    );
    const entries = Array.isArray(change.value.history)
      ? change.value.history
      : [];

    for (const entry of entries) {
      const entryObject = objectAt(entry);
      const rows = Array.isArray(entryObject?.threads) ? entryObject.threads : [];

      for (const row of rows) {
        const thread = objectAt(row);
        if (!thread) continue;

        const context = objectAt(thread.context);
        const messages = Array.isArray(thread.messages) ? thread.messages : [];
        const parsed = messages
          .map((message) => historyMessageOf(message, business))
          .filter((message): message is HistoryMessage => message !== null);

        threads.push({
          phoneNumberId,
          phone: stringAt(thread.id) ?? stringAt(context?.wa_id),
          bsuid: stringAt(context?.user_id),
          username: stringAt(context?.username),
          messages: parsed,
        });
      }
    }
  }

  return threads;
}

function historyMessageOf(
  input: unknown,
  business: string | null,
): HistoryMessage | null {
  const message = objectAt(input);
  const wamid = stringAt(message?.id);
  const type = stringAt(message?.type);
  const at = instantOf(message?.timestamp);

  // A message without an id cannot be deduped, and one without a timestamp
  // cannot be placed: both would be a row we could never correct.
  if (!message || !wamid || !type || !at) return null;

  const kind = kindOf(type);
  // A placeholder names no contents; asking for `message[type]` would look up
  // a key Meta does not send.
  const content = kind === "MEDIA_PENDING" ? null : objectAt(message[type]);
  const direction = directionOf(message, business);
  const reported = stringAt(objectAt(message.history_context)?.status);
  const status =
    (reported ? HISTORY_STATUS[reported] : undefined) ??
    (direction === "INBOUND" ? "DELIVERED" : "SENT");

  return {
    wamid,
    direction,
    kind,
    status,
    body:
      stringAt(objectAt(message.text)?.body) ??
      stringAt(content?.caption) ??
      (kind === "UNSUPPORTED" ? `[${type}]` : null),
    mediaId: stringAt(content?.id),
    mediaMime: stringAt(content?.mime_type),
    mediaSha256: stringAt(content?.sha256),
    errorReason: status === "FAILED" ? HISTORY_FAILED : null,
    at,
  };
}

/**
 * `from_user_id` is documented as "only included if the message is from the
 * user", which is the strongest signal in the payload. The rest is the
 * documented fallback order, because a payload can omit both handles.
 */
function directionOf(
  message: Json,
  business: string | null,
): "INBOUND" | "OUTBOUND" {
  if (stringAt(message.from_user_id)) return "INBOUND";
  if (stringAt(message.to)) return "OUTBOUND";

  const from = digits(stringAt(message.from));
  if (business !== null && from !== null && from === business) return "OUTBOUND";

  return "INBOUND";
}

/** One row per number: the highest `progress` any entry of this delivery saw. */
export function historyProgress(payload: unknown): SyncProgress[] {
  const best = new Map<string, number>();

  for (const change of changesOf(payload)) {
    if (change.field !== "history") continue;

    const phoneNumberId = phoneNumberOf(change.value);
    if (!phoneNumberId) continue;

    const entries = Array.isArray(change.value.history)
      ? change.value.history
      : [];

    for (const entry of entries) {
      const progress = numberAt(objectAt(objectAt(entry)?.metadata)?.progress);
      if (progress === null) continue;

      const previous = best.get(phoneNumberId);
      if (previous === undefined || progress > previous) {
        best.set(phoneNumberId, progress);
      }
    }
  }

  return [...best].map(([phoneNumberId, progress]) => ({
    phoneNumberId,
    progress,
  }));
}

/**
 * Meta's decline is the one delivery with no `entry[].changes[]` wrapper: a
 * bare `{ messaging_product, metadata, history }` object. Both shapes are
 * read, because a payload we cannot name is a screen that waits forever.
 */
export function historyDeclined(payload: unknown): DeclinedSync[] {
  const found: DeclinedSync[] = [];
  const bare = objectAt(payload);

  const bareNumber = bare ? phoneNumberOf(bare) : null;
  const bareHistory = bare && Array.isArray(bare.history) ? bare.history : null;

  if (bareNumber && bareHistory) {
    collectDeclines(found, bareNumber, bareHistory);
  }

  for (const change of changesOf(payload)) {
    if (change.field !== "history") continue;

    const phoneNumberId = phoneNumberOf(change.value);
    const entries = Array.isArray(change.value.history)
      ? change.value.history
      : [];

    if (phoneNumberId) collectDeclines(found, phoneNumberId, entries);
  }

  return found;
}

function collectDeclines(
  found: DeclinedSync[],
  phoneNumberId: string,
  entries: unknown[],
): void {
  for (const entry of entries) {
    const entryObject = objectAt(entry);
    const errors = Array.isArray(entryObject?.errors)
      ? (entryObject.errors as unknown[])
      : [];

    for (const error of errors) {
      const row = objectAt(error);
      if (numberAt(row?.code) !== DECLINED_CODE) continue;

      found.push({
        phoneNumberId,
        sentence: stringAt(row?.title) ?? DECLINED_TITLE,
      });
    }
  }
}

/**
 * The media that belongs to a placeholder, in its own `field: "history"`
 * delivery. Gated on the field name: a live delivery also carries
 * `value.messages`, and those are already the inbox's business.
 */
export function mediaAssets(payload: unknown): MediaAsset[] {
  const assets: MediaAsset[] = [];

  for (const change of changesOf(payload)) {
    if (change.field !== "history") continue;

    const phoneNumberId = phoneNumberOf(change.value);
    if (!phoneNumberId) continue;

    const messages = Array.isArray(change.value.messages)
      ? change.value.messages
      : [];

    for (const row of messages) {
      const message = objectAt(row);
      const wamid = stringAt(message?.id);
      const type = stringAt(message?.type);
      const at = instantOf(message?.timestamp);

      if (!message || !wamid || !type || !at) continue;

      const kind = kindOf(type);
      // An asset names a real kind. Anything else is not an asset.
      if (!MEDIA_KINDS.has(kind)) continue;

      const content = objectAt(message[type]);

      assets.push({
        phoneNumberId,
        wamid,
        from: stringAt(message.from),
        kind,
        mediaId: stringAt(content?.id),
        mediaMime: stringAt(content?.mime_type),
        mediaSha256: stringAt(content?.sha256),
        caption: stringAt(content?.caption),
        at,
      });
    }
  }

  return assets;
}

export function stateSyncContacts(payload: unknown): SyncedContact[] {
  const contacts: SyncedContact[] = [];

  for (const change of changesOf(payload)) {
    const phoneNumberId = phoneNumberOf(change.value);
    if (!phoneNumberId) continue;

    const rows = Array.isArray(change.value.state_sync)
      ? change.value.state_sync
      : [];

    for (const row of rows) {
      const entry = objectAt(row);
      const contact = objectAt(entry?.contact);
      const action = stringAt(entry?.action);

      if (!contact || (action !== "add" && action !== "remove")) continue;

      contacts.push({
        phoneNumberId,
        phone: stringAt(contact.phone_number),
        bsuid: stringAt(contact.user_id),
        fullName: stringAt(contact.full_name),
        firstName: stringAt(contact.first_name),
        action,
      });
    }
  }

  return contacts;
}