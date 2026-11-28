import type {
  BotAction,
  BotButton,
  BotCard,
  BotFlow,
  BotRule,
  CardFile,
} from "./bot.card";

/**
 * What a sent card leaves in `messages.payload`.
 *
 * The whole flow travels with the message, not just the card that went out.
 * That is what makes a tap answerable without a table: the next card is already
 * in the payload, so the conversation follows the menu the customer is looking
 * at even though the business has since edited it. The alternative — resolving
 * `action.cardId` against stored cards — needs `bot_cards` to exist, and it
 * would answer against a card that was never on screen.
 */
export interface CardSnapshot {
  flow: BotFlow;
  /** The card that was sent, and therefore the one the buttons belong to. */
  cardId: string;
}

export function snapshotOf(flow: BotFlow, cardId: string): CardSnapshot {
  return { flow, cardId };
}

/**
 * The snapshot in a stored payload, read defensively.
 *
 * This is the one place an unknown JSON column becomes typed data. A payload
 * written before cards existed, a customer's own location, a hand-edited row:
 * all of them are simply "no card", not an exception on the reply path. The
 * shape is checked field by field because everything downstream — which button,
 * which card — indexes into it.
 */
export function snapshotIn(payload: unknown): CardSnapshot | null {
  const root = objectAt(payload);
  const flow = flowAt(root?.flow);
  const cardId = stringAt(root?.cardId);

  if (!flow || !cardId) return null;

  return { flow, cardId };
}

/**
 * A stored flow, read defensively.
 *
 * The same reader the outgoing message uses, exported because a saved flow and
 * a sent one have to be the same shape: the builder writes what the renderer
 * and the router already know how to read, and nothing else.
 */
export function flowIn(value: unknown): BotFlow | null {
  return flowAt(value);
}

function flowAt(value: unknown): BotFlow | null {
  const flow = objectAt(value);
  const id = stringAt(flow?.id);

  if (!flow || !id || !Array.isArray(flow.cards)) return null;

  const cards = flow.cards
    .map(cardAt)
    .filter((card): card is BotCard => card !== null);

  // Absent on every row written before rules existed, and that is not an error:
  // a flow with no rules behaves exactly as it always did.
  const rules = Array.isArray(flow.rules)
    ? flow.rules.map(ruleAt).filter((rule): rule is BotRule => rule !== null)
    : [];

  return { id, rootCardId: stringAt(flow.rootCardId), cards, rules };
}

/**
 * A stored keyword rule, read defensively.
 *
 * A rule with no trigger can never fire and a rule with no card can never
 * answer, so both are dropped here rather than turned into silence. Saving
 * refuses them too; this is the reader for rows written by hand.
 */
function ruleAt(value: unknown): BotRule | null {
  const rule = objectAt(value);
  const id = stringAt(rule?.id);
  const replyCardId = stringAt(rule?.replyCardId);

  if (!rule || !id || !replyCardId) return null;

  const triggers = Array.isArray(rule.triggers)
    ? rule.triggers.filter(
        (word): word is string =>
          typeof word === "string" && word.trim().length > 0,
      )
    : [];

  if (triggers.length === 0) return null;

  return { id, triggers, replyCardId, enabled: rule.enabled !== false };
}

function cardAt(value: unknown): BotCard | null {
  const card = objectAt(value);
  const id = stringAt(card?.id);

  if (!card || !id) return null;

  const buttons = Array.isArray(card.buttons)
    ? card.buttons
        .map(buttonAt)
        .filter((button): button is BotButton => button !== null)
    : [];

  return {
    id,
    name: nameAt(card),
    title: stringAt(card.title) ?? "",
    imageUrls: imageUrlsAt(card),
    files: filesAt(card),
    info: stringAt(card.info) ?? "",
    buttons,
  };
}

/**
 * The card's name, as stored.
 *
 * A flow written before cards were named has no `name` key at all, and the
 * heading was the only label it ever had — so the heading is what keeps such a
 * card readable in a list. A card saved by a version that knows about names
 * always carries the key, even when it is empty, and empty means the business
 * has not named it yet: that is a card the builder labels "Untitled card".
 */
function nameAt(card: Json): string {
  if (typeof card.name === "string") return card.name;

  return stringAt(card.title) ?? "";
}

/**
 * The card's pictures, in order.
 *
 * `imageUrl` is the single-picture field every flow and every delivered card
 * written before photo sets used; lifting it to a one-entry list is what lets
 * those keep rendering. Duplicates are dropped because a hand-edited row is the
 * only way to get them — saving refuses them — and the same picture twice is
 * still one picture.
 */
function imageUrlsAt(card: Json): string[] {
  const listed = Array.isArray(card.imageUrls)
    ? card.imageUrls
        // Trimmed because a stray space is not a different picture, and Meta
        // would reject the address rather than ignore the space.
        .filter((url): url is string => typeof url === "string")
        .map((url) => url.trim())
        .filter((url) => url.length > 0)
    : [];

  if (listed.length > 0) return [...new Set(listed)];

  const single = stringAt(card.imageUrl);

  return single ? [single] : [];
}

/**
 * The card's files, in order.
 *
 * Absent on every flow written before cards could carry one, and that is not an
 * error: a card with no files behaves exactly as it always did. A row with no
 * address, or with a kind this version does not send, is dropped rather than
 * handed to the sender — Meta would reject the message and the customer would
 * get a card with a hole in front of it.
 */
function filesAt(card: Json): CardFile[] {
  if (!Array.isArray(card.files)) return [];

  const files: CardFile[] = [];
  const seen = new Set<string>();

  for (const raw of card.files) {
    const row = objectAt(raw);
    const url = stringAt(row?.url)?.trim();
    const kind = stringAt(row?.kind);

    if (!url || (kind !== "document" && kind !== "video")) continue;
    if (seen.has(url)) continue;

    seen.add(url);
    files.push({ url, name: stringAt(row?.name) ?? nameFromUrl(url), kind });
  }

  return files;
}

/** The last segment of an address, for a file stored without a name. */
function nameFromUrl(url: string): string {
  const base = url.split(/[?#]/u)[0]?.split("/").pop() ?? "";

  try {
    return decodeURIComponent(base) || "file";
  } catch {
    return base || "file";
  }
}

function buttonAt(value: unknown): BotButton | null {
  const button = objectAt(value);
  const id = stringAt(button?.id);
  const label = stringAt(button?.label);
  const action = actionAt(button?.action);

  if (!id || label === null || !action) return null;

  return { id, label, action };
}

/** Only the four actions the router can produce; anything else is dropped. */
function actionAt(value: unknown): BotAction | null {
  const action = objectAt(value);

  switch (stringAt(action?.kind)) {
    case "card": {
      const cardId = stringAt(action?.cardId);
      return cardId ? { kind: "card", cardId } : null;
    }
    case "link": {
      const url = stringAt(action?.url);
      return url ? { kind: "link", url } : null;
    }
    case "handoff":
      return { kind: "handoff" };
    case "text": {
      const body = stringAt(action?.body);
      return body ? { kind: "text", body } : null;
    }
    default:
      return null;
  }
}

type Json = Record<string, unknown>;

function objectAt(value: unknown): Json | null {
  return value !== null && typeof value === "object" ? (value as Json) : null;
}

/** An empty string is not a value here: a button with no id cannot be routed. */
function stringAt(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
