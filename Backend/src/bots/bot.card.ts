/**
 * A bot is a tree of cards. One card is one step: its pictures, the information
 * the business wants to give, and the buttons that lead on from it.
 *
 * A card can therefore leave as several WhatsApp messages — the Cloud API has
 * no album, so every picture past the first is sent on its own — but the card
 * is still the unit the owner edits and a tap is routed by.
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

/**
 * The two kinds of file a card can hand over.
 *
 * Only two, because they are the two shapes WhatsApp draws differently: a
 * document arrives as a tappable row with its own file name, and a video plays
 * in the thread. Anything else a business wants to send is uploaded as one of
 * these.
 */
export type CardFileKind = "document" | "video";

/**
 * A file that travels with a card.
 *
 * WhatsApp has no attachment on an interactive message, so a file is always a
 * message of its own, sent just before the card. It is never the header: a
 * card's header is a picture or a line of text, and a customer reading a menu
 * should still see the menu.
 */
export interface CardFile {
  /** Permanent public address; Meta fetches it when the card is sent. */
  url: string;
  /**
   * What the customer's phone calls the download, extension included.
   *
   * WhatsApp shows this instead of the address, so it is the one piece of the
   * original upload worth keeping.
   */
  name: string;
  kind: CardFileKind;
}

export interface BotCard {
  id: string;
  /**
   * What the business calls this card, and nothing else: "Welcome", "Pricing
   * menu", "Support options".
   *
   * Internal. No renderer reads it, so renaming a card cannot change one word
   * a customer sees — that is the whole reason it is a field of its own rather
   * than the same string as the heading.
   */
  name: string;
  /**
   * The heading the customer reads: the header when the card has no pictures,
   * or when the pictures travel separately.
   */
  title: string;
  /**
   * Public URLs, in the order the customer receives them.
   *
   * Meta fetches each one, so none can be a local path. A list rather than a
   * single picture because WhatsApp has no album: one picture can be an
   * interactive header, and everything past it travels as its own image
   * message. The first entry is the card's cover.
   */
  imageUrls: string[];
  /**
   * Files handed over with this card, in the order the customer receives them.
   *
   * Each is its own message, sent before the pictures and before the card. A
   * card may carry a few — a price list, a booking form, a short clip — because
   * a business often answers with the document rather than the menu.
   */
  files: CardFile[];
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
