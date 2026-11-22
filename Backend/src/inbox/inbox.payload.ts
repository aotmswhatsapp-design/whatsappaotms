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

/** A location the customer shared; the same shape we send back. */
export interface LocationContents {
  latitude: number;
  longitude: number;
  name: string | null;
  address: string | null;
}

/** One card out of a contact message, reduced to what a bubble can show. */
export interface ContactCard {
  name: string;
  phones: string[];
  emails: string[];
  organization: string | null;
}

export interface ContactCardsContents {
  contacts: ContactCard[];
}

/** `payload` on a message: the contents of a kind that is not text or a file. */
export type ParsedContents = LocationContents | ContactCardsContents | null;

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
  /** The message this one quotes or reacts to, when Meta named one. */
  contextWamid: string | null;
  payload: ParsedContents;
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
    case "reaction":
      return "REACTION";
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
  const reaction = objectAt(message.reaction);

  const seconds = Number(message.timestamp);

  return {
    wamid,
    from,
    timestamp: Number.isFinite(seconds) && seconds > 0
      ? new Date(seconds * 1000)
      : new Date(),
    kind,
    body:
      (kind === "REACTION" ? stringAt(reaction?.emoji) : null) ??
      stringAt(objectAt(message.text)?.body) ??
      stringAt(content?.caption) ??
      tapText(message) ??
      systemText(message) ??
      (kind === "UNSUPPORTED" ? `[${type}]` : null),
    mediaId: stringAt(content?.id),
    mediaMime: stringAt(content?.mime_type),
    mediaName: stringAt(content?.filename),
    mediaSha256: stringAt(content?.sha256),
    // A reaction names its target inside the reaction object; everything else
    // that quotes names it in `context.id`.
    contextWamid:
      stringAt(reaction?.message_id) ?? stringAt(objectAt(message.context)?.id),
    payload: locationOf(message.location) ?? contactCardsOf(message.contacts),
  };
}

/**
 * A `system` message is a note from WhatsApp itself — the customer changed
 * their number, and similar. It has no body of its own, so before this it was
 * stored as the literal `[system]`.
 */
function systemText(message: Json): string | null {
  const system = objectAt(message.system);

  return stringAt(system?.body) ?? null;
}

function numberAt(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function locationOf(value: unknown): LocationContents | null {
  const location = objectAt(value);
  const latitude = numberAt(location?.latitude);
  const longitude = numberAt(location?.longitude);

  if (latitude === null || longitude === null) return null;

  return {
    latitude,
    longitude,
    name: stringAt(location?.name),
    address: stringAt(location?.address),
  };
}

function contactCardsOf(value: unknown): ContactCardsContents | null {
  if (!Array.isArray(value)) return null;

  const contacts = value.map(contactCardOf).filter((card) => card !== null);

  return contacts.length > 0 ? { contacts } : null;
}

function contactCardOf(value: unknown): ContactCard | null {
  const card = objectAt(value);
  const name = objectAt(card?.name);
  const formatted =
    stringAt(name?.formatted_name) ??
    ([stringAt(name?.first_name), stringAt(name?.last_name)]
      .filter(Boolean)
      .join(" ") ||
      null);

  if (!formatted) return null;

  return {
    name: formatted,
    phones: valuesOf(card?.phones, "phone"),
    emails: valuesOf(card?.emails, "email"),
    organization: stringAt(objectAt(card?.org)?.company),
  };
}

function valuesOf(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => stringAt(objectAt(entry)?.[key]))
    .filter((row): row is string => row !== null);
}

/**
 * The words the customer tapped. A reply arrives as `button` or `interactive`
 * and carries its label in a different place in each shape — Meta's own docs
 * are explicit that the interactive shape has no `button_reply` once the
 * message was delivered as a template, so all three are read.
 */
function tapText(message: Json): string | null {
  const interactive = objectAt(message.interactive);

  return (
    stringAt(objectAt(message.button)?.text) ??
    stringAt(objectAt(interactive?.button_reply)?.title) ??
    stringAt(objectAt(interactive?.list_reply)?.title)
  );
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
