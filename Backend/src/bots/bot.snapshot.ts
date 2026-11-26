import type { BotAction, BotButton, BotCard, BotFlow } from "./bot.card";

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

  return { id, rootCardId: stringAt(flow.rootCardId), cards };
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
    title: stringAt(card.title) ?? "",
    imageUrl: stringAt(card.imageUrl),
    info: stringAt(card.info) ?? "",
    buttons,
  };
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
