import type { BotCard, BotFlow } from "./bot.card";
import { routeTap, targetOf } from "./bot.route";
import { snapshotIn } from "./bot.snapshot";
import { readTap } from "./bot.tap";

/** Copy, not business information: the branch a tap pointed at is gone. */
export const CARD_GONE_MESSAGE = "That option is no longer available.";

/**
 * What a tap, or the message that followed it, asks the conversation to do.
 *
 * `none` is the important case: a customer whose last card offered Drinks and
 * Food can still type "do you deliver?", and that must be answered from the
 * knowledge base rather than silently swallowed by the menu. Only a message
 * that actually picks a button — by id, by number, by the words on it — becomes
 * a card turn.
 */
export type CardTurn =
  | { kind: "none" }
  | { kind: "say"; body: string }
  | { kind: "handoff" }
  | { kind: "card"; flow: BotFlow; card: BotCard };

export function cardTurn(input: {
  /** The message as the thread shows it: the tapped title, or what was typed. */
  body: string | null;
  /** The stored contents: `{ tap: { id, title } }` for a button or a list row. */
  payload: unknown;
  /** The newest outbound message's payload; null when nothing has been sent. */
  lastOutbound: unknown;
}): CardTurn {
  const snapshot = snapshotIn(input.lastOutbound);
  if (!snapshot) return { kind: "none" };

  const card = snapshot.flow.cards.find((row) => row.id === snapshot.cardId);
  if (!card) return { kind: "none" };

  const action = routeTap(
    card,
    readTap({ body: input.body, payload: input.payload }),
  );

  if (!action) return { kind: "none" };

  switch (action.kind) {
    case "card": {
      const next = targetOf(snapshot.flow.cards, action);

      // The action outlived its card — a flow edited between two sends. The
      // customer gets a sentence instead of silence, and the flow does not
      // change: the card they are looking at is still the one they tapped.
      return next
        ? { kind: "card", flow: snapshot.flow, card: next }
        : { kind: "say", body: CARD_GONE_MESSAGE };
    }
    case "link":
      return { kind: "say", body: action.url };
    case "text":
      return { kind: "say", body: action.body };
    case "handoff":
      return { kind: "handoff" };
  }
}
