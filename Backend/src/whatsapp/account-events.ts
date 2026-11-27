/**
 * `account_update` deliveries: the customer's Messaging account changed state.
 *
 * The shape is unlike every other delivery. `entry[].id` is the *partner's*
 * business id here, not the customer's account, so the webhook's normal lookup
 * key finds no row — a disconnection used to be logged as "unregistered
 * account" and never reached the workspace. The account is named inside
 * `value.waba_info`, except on the offboard/reconnect events, where
 * `entry[].id` itself is the account.
 *
 * Pure on purpose: the sentences below are the only thing a disconnected owner
 * sees, and a copied payload is how they are tested.
 */

export interface AccountEvent {
  /** The customer's Messaging account, which is what our row is keyed by. */
  wabaId: string;
  /** `PARTNER_REMOVED`, `ACCOUNT_OFFBOARDED`, `ACCOUNT_RECONNECTED`, … */
  event: string;
  /** Meta's machine reason for a disconnection, when it sent one. */
  reason: string | null;
  /** `USER` when the customer did it, `SYSTEM` when WhatsApp did. */
  initiatedBy: string | null;
}

const KNOWN_DISCONNECTS = new Set(["PARTNER_REMOVED", "ACCOUNT_OFFBOARDED"]);

/** Whether this event means the stored token no longer works. */
export function isDisconnect(event: AccountEvent): boolean {
  return KNOWN_DISCONNECTS.has(event.event);
}

export function accountEvents(payload: unknown): AccountEvent[] {
  const root = objectAt(payload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];

  const found: AccountEvent[] = [];

  for (const entry of entries) {
    const entryObject = objectAt(entry);
    const entryId = stringAt(entryObject?.id);
    const changes = Array.isArray(entryObject?.changes)
      ? entryObject.changes
      : [];

    for (const change of changes) {
      const changeObject = objectAt(change);

      // Only this field carries state events. Every other change in the same
      // delivery (messages, history, state sync) has no `value.event`, and a
      // future one that grew the key must not be read as a disconnection.
      if (changeObject?.field !== "account_update") continue;

      const value = objectAt(changeObject.value);
      const event = stringAt(value?.event);
      const wabaInfo = objectAt(value?.waba_info);
      const wabaId = stringAt(wabaInfo?.waba_id) ?? entryId;

      if (!event || !wabaId) continue;

      const info = objectAt(value?.disconnection_info);

      found.push({
        wabaId,
        event,
        reason: stringAt(info?.reason),
        initiatedBy: stringAt(info?.initiated_by),
      });
    }
  }

  return found;
}

/**
 * The sentence the connection screen shows instead of "Meta no longer accepts
 * these credentials".
 *
 * Kept here, beside the codes it translates, so a new reason cannot be added to
 * the parse without someone deciding what a customer reads.
 */
export function disconnectNote(event: AccountEvent): string {
  const actor = event.initiatedBy === "SYSTEM" ? "WhatsApp" : "the business";

  switch (event.reason) {
    case "ACCOUNT_DISCONNECTED":
      return `The WhatsApp account was disconnected by ${actor}. Connect it again to keep answering.`;
    case "BUSINESS_DOWNGRADE":
      return "The number was registered with the WhatsApp Messenger app, which ends the Cloud API connection.";
    case "CHANGE_NUMBER":
      return "The business changed its phone number, so the number stored here no longer exists.";
    case "COMPANION_INACTIVITY":
      return "The phone stayed offline for about 30 days, so WhatsApp closed this connection.";
    case "PRIMARY_INACTIVITY":
      return "The phone stayed offline for about 14 days, so WhatsApp closed this connection.";
    case "USER_RE_REGISTERED":
      return "The number was re-registered on a new device, which ends the Cloud API connection.";
    default:
      return event.event === "ACCOUNT_OFFBOARDED"
        ? "The business disconnected WhatsApp from Cloud API in the WhatsApp Business app."
        : "WhatsApp closed this connection. Connect the number again to keep answering.";
  }
}

type Json = Record<string, unknown>;

function objectAt(value: unknown): Json | null {
  return value !== null && typeof value === "object" ? (value as Json) : null;
}

function stringAt(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
