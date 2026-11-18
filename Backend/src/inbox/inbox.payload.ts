import type { MessageKind } from "@prisma/client";

/**
 * Meta's delivery payload, reduced to the shapes the inbox stores.
 *
 * Kept free of Nest and Prisma so it can be exercised with a copied payload:
 * this is the one part of the webhook where a wrong assumption is silent.
 */

export interface ParsedContact {
  waId: string;
  profileName: string | null;
}

export interface ParsedMessage {
  wamid: string;
  /** The customer's number, digits only. */
  from: string;
  timestamp: Date;
  kind: MessageKind;
  body: string | null;
  mediaId: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  mediaSha256: string | null;
}

export type ParsedDeliveryStatus = "sent" | "delivered" | "read" | "failed";

export interface ParsedStatus {
  wamid: string;
  status: ParsedDeliveryStatus;
  error: string | null;
}

/** One `entry[].changes[]` item that carries messages for one number. */
export interface ParsedChange {
  phoneNumberId: string;
  contacts: ParsedContact[];
  messages: ParsedMessage[];
  statuses: ParsedStatus[];
}

const MEDIA: Record<string, MessageKind> = {
  image: "IMAGE",
  document: "DOCUMENT",
  audio: "AUDIO",
  video: "VIDEO",
  sticker: "STICKER",
};

function kindOf(type: string): MessageKind {
  switch (type) {
    case "text":
      return "TEXT";
    case "location":
      return "LOCATION";
    case "contacts":
      return "CONTACTS";
    case "button":
      return "BUTTON";
    case "interactive":
      return "INTERACTIVE";
    default:
      return MEDIA[type] ?? "UNSUPPORTED";
  }
}

type Json = Record<string, unknown>;

function objectAt(value: unknown): Json | null {
  return value !== null && typeof value === "object" ? (value as Json) : null;
}

function stringAt(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseDelivery(payload: unknown): ParsedChange[] {
  const root = objectAt(payload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];

  const changes: ParsedChange[] = [];

  for (const entry of entries) {
    const entryObject = objectAt(entry);
    const entryChanges = Array.isArray(entryObject?.changes)
      ? entryObject.changes
      : [];

    for (const change of entryChanges) {
      const changeObject = objectAt(change);
      const value = objectAt(changeObject?.value);
      const metadata = objectAt(value?.metadata);
      const phoneNumberId = stringAt(metadata?.phone_number_id);

      // A delivery for something other than a connected number (or a test
      // event) has nothing to store.
      if (!phoneNumberId) continue;

      const contacts: ParsedContact[] = [];

      if (Array.isArray(value?.contacts)) {
        for (const contact of value.contacts) {
          const row = objectAt(contact);
          const waId = stringAt(row?.wa_id);

          if (!waId) continue;

          contacts.push({
            waId,
            profileName: stringAt(objectAt(row?.profile)?.name),
          });
        }
      }

      const messages: ParsedMessage[] = [];

      if (Array.isArray(value?.messages)) {
        for (const message of value.messages) {
          const parsed = parseMessage(message);

          if (parsed) messages.push(parsed);
        }
      }

      const statuses: ParsedStatus[] = [];

      if (Array.isArray(value?.statuses)) {
        for (const status of value.statuses) {
          const parsed = parseStatus(status);

          if (parsed) statuses.push(parsed);
        }
      }

      if (messages.length === 0 && statuses.length === 0 && contacts.length === 0) {
        continue;
      }

      changes.push({ phoneNumberId, contacts, messages, statuses });
    }
  }

  return changes;
}

function parseMessage(input: unknown): ParsedMessage | null {
  const message = objectAt(input);
  const wamid = stringAt(message?.id);
  const from = stringAt(message?.from);
  const type = stringAt(message?.type);

  if (!message || !wamid || !from || !type) return null;

  const kind = kindOf(type);

  // The type names the payload key: `image` carries `message.image`.
  const content = MEDIA[type] ? objectAt(message[type]) : null;

  const seconds = Number(message.timestamp);

  return {
    wamid,
    from,
    timestamp: Number.isFinite(seconds) && seconds > 0
      ? new Date(seconds * 1000)
      : new Date(),
    kind,
    body:
      stringAt(objectAt(message.text)?.body) ??
      stringAt(content?.caption) ??
      (kind === "UNSUPPORTED" ? `[${type}]` : null),
    mediaId: stringAt(content?.id),
    mediaMime: stringAt(content?.mime_type),
    mediaName: stringAt(content?.filename),
    mediaSha256: stringAt(content?.sha256),
  };
}

function parseStatus(input: unknown): ParsedStatus | null {
  const status = objectAt(input);
  const wamid = stringAt(status?.id);
  const value = stringAt(status?.status);

  if (!wamid) return null;

  if (
    value !== "sent" &&
    value !== "delivered" &&
    value !== "read" &&
    value !== "failed"
  ) {
    return null;
  }

  const errors = Array.isArray(status?.errors) ? status.errors : [];
  const first = objectAt(errors[0]);

  return {
    wamid,
    status: value,
    error: stringAt(first?.title) ?? stringAt(first?.message),
  };
}
