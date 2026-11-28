import type { BotCard, BotFlow } from "./bot.card";
import { buttonWith, routeTap, targetOf } from "./bot.route";
import { snapshotIn } from "./bot.snapshot";
import { readTap, type TapEvidence } from "./bot.tap";

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
  /**
   * What we sent to this thread, newest first.
   *
   * Every card leaves its flow and its own id behind, so this is where a tap on
   * a card that is no longer the newest message is found. Anything that is not
   * a card — an answer, a handoff line, a location — is skipped.
   */
  outbound: readonly unknown[];
  /** The agent's flow as it is stored now, when it could be read. */
  flow?: BotFlow | null;
}): CardTurn {
  const tap = readTap({ body: input.body, payload: input.payload });

  // A tap is the customer pointing at a button they were given, so it is
  // answered by the card that gave it — not by whatever we sent last, and not
  // by a search for the words printed on it. The id survives a rename and a
  // scroll back, so it is the one piece of evidence worth hunting for.
  if (tap.id) {
    const holder =
      sentCard(input.outbound, tap.id) ?? presentCard(input.flow, tap.id);

    if (holder) {
      const claimed = effect(holder.flow, holder.card, tap);
      if (claimed.kind !== "none") return claimed;
    }
  }

  // Typed text, or a tap whose button was deleted before it arrived: only the
  // menu the customer is looking at can be read from position and wording.
  const snapshot = snapshotIn(input.outbound[0] ?? null);
  if (!snapshot) return { kind: "none" };

  const card = snapshot.flow.cards.find((row) => row.id === snapshot.cardId);
  if (!card) return { kind: "none" };

  return effect(snapshot.flow, card, tap);
}

/**
 * The card a tapped id was drawn on, searched newest message first.
 *
 * The snapshot carries its whole flow, so this needs no second read and cannot
 * disagree with what the customer actually saw: a card edited after it was sent
 * still routes by the buttons that were on screen. Newest first matters when
 * the same id appears twice — the copy the customer is nearest to wins.
 */
function sentCard(
  outbound: readonly unknown[],
  id: string,
): { flow: BotFlow; card: BotCard } | null {
  for (const payload of outbound) {
    const snapshot = snapshotIn(payload);
    if (!snapshot) continue;

    const card = snapshot.flow.cards.find((row) => buttonWith(row, id));

    if (card) return { flow: snapshot.flow, card };
  }

  return null;
}

/**
 * The card of the flow as it stands now that offers this id.
 *
 * The message carrying a card can sit further back than the window we read — a
 * long thread, a menu sent weeks ago — while the flow still holds the button
 * and the action it points at. Ids live inside one flow, so a hit here is the
 * same tap, answered with the business's current wording.
 */
function presentCard(
  flow: BotFlow | null | undefined,
  id: string,
): { flow: BotFlow; card: BotCard } | null {
  const card = flow?.cards.find((row) => buttonWith(row, id));

  return card && flow ? { flow, card } : null;
}

/** What the button this tap names asks for. The one place actions become work. */
function effect(flow: BotFlow, card: BotCard, tap: TapEvidence): CardTurn {
  const action = routeTap(card, tap);

  if (!action) return { kind: "none" };

  switch (action.kind) {
    case "card": {
      const next = targetOf(flow.cards, action);

      // The action outlived its card — a flow edited between two sends. The
      // customer gets a sentence instead of silence, and the flow does not
      // change: the card they are looking at is still the one they tapped.
      return next
        ? { kind: "card", flow, card: next }
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
