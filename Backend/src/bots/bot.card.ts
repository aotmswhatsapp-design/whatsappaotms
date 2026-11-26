/**
 * A bot is a tree of cards. One card is one message: an optional picture, the
 * information the business wants to give, and the buttons that lead on from it.
 *
 * Deliberately just data. Nothing here knows about Prisma, WhatsApp or HTTP, so
 * the renderer and the router can be exercised without either, and the stored
 * shape is the shape the builder edits.
 */

/** What a button does when the customer taps it. */
export type BotAction =
  /** Show another card of the same bot. */
  | { kind: "card"; cardId: string }
  /** Open a URL the business owns. */
  | { kind: "link"; url: string }
  /** Stop the bot and put a person in the thread. */
  | { kind: "handoff" }
  /** Answer with a fixed sentence and no buttons. */
  | { kind: "text"; body: string };

export interface BotButton {
  /**
   * Stable for the life of the card, and what a tap is routed by.
   *
   * The label is not: a business that renames "Drinks" to "Beverages" would
   * otherwise break every flow that pointed at it, and two buttons may legally
   * read the same.
   */
  id: string;
  label: string;
  action: BotAction;
}

export interface BotCard {
  id: string;
  /** The card's own name, shown as the header when the card has no image. */
  title: string;
  /** A public URL. Meta fetches it, so it cannot be a local path. */
  imageUrl: string | null;
  /** The information itself: the body of the message. */
  info: string;
  /** In the order the customer sees them, which is also the order they number in. */
  buttons: BotButton[];
}

/**
 * "When the customer says this, send that."
 *
 * The reply is a card of the same flow rather than a copy of one: the builder
 * already edits cards, and a rule that carried its own message would be a second
 * editor that could disagree with the first. `enabled` is kept because a rule is
 * usually rewritten rather than deleted, and a half-edited rule must not answer
 * anybody while it is being changed.
 */
export interface BotRule {
  id: string;
  /** Words or short phrases, in the customer's own language. Any one fires. */
  triggers: string[];
  /** The card of this flow that goes out when a trigger matches. */
  replyCardId: string;
  enabled: boolean;
}

/** Where the bot starts. */
export interface BotFlow {
  id: string;
  /** Null means the bot has no entry card and cannot greet anyone yet. */
  rootCardId: string | null;
  cards: BotCard[];
  /**
   * Keyword rules, in the order they are tried: the first match answers.
   *
   * Reading a flow written before rules existed yields `[]`, so nothing that
   * already works changes behaviour until a rule is added.
   */
  rules: BotRule[];
}

/**
 * The buttons a customer can actually see.
 *
 * One definition, because two things depend on agreeing: the renderer numbers
 * the fallback text from this list, and the router turns "2" back into the
 * second entry of the same list. A blank label is not a button the customer was
 * offered, so it is not one they can pick.
 */
export function shownButtons(card: BotCard): BotButton[] {
  return card.buttons.filter((button) => button.label.trim().length > 0);
}
