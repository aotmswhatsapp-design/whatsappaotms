import {
  shownButtons,
  type BotAction,
  type BotButton,
  type BotCard,
} from "./bot.card";
import type { TapEvidence } from "./bot.tap";

/**
 * The button this card offers under this id, or null.
 *
 * One definition, because two lookups have to agree: the id half of
 * `routeTap`, and the search that finds which card a tap came from when it is
 * no longer the newest message. A blank-labelled button is not one the
 * customer was shown, so an id can never point at one.
 */
export function buttonWith(card: BotCard, id: string): BotButton | null {
  return shownButtons(card).find((button) => button.id === id) ?? null;
}

/**
 * Which button of this card the customer picked.
 *
 * The id wins whenever it still exists, and only then the number and the words.
 * That order is what makes a card editable: a business can rename "Drinks" to
 * "Beverages", and a customer's tap — which travels with the id — still lands on
 * the same action. A tap on a button that has since been deleted falls through to
 * the weaker evidence rather than dead-ending the conversation.
 *
 * Two buttons with the same label are legal; the first one in the card wins.
 */
export function routeTap(card: BotCard, tap: TapEvidence): BotAction | null {
  const buttons = shownButtons(card);

  if (tap.id) {
    const byId = buttonWith(card, tap.id);
    if (byId) return byId.action;
  }

  if (tap.number !== null) {
    const byNumber = buttons[tap.number - 1];
    if (byNumber) return byNumber.action;
  }

  const wanted = tap.label?.trim().toLowerCase() ?? "";
  if (wanted.length === 0) return null;

  return (
    buttons.find((button) => button.label.trim().toLowerCase() === wanted)?.action ??
    null
  );
}

/** The card a `card` action points at, or null when the flow no longer holds it. */
export function targetOf(
  cards: BotCard[],
  action: BotAction,
): BotCard | null {
  if (action.kind !== "card") return null;

  return cards.find((card) => card.id === action.cardId) ?? null;
}
