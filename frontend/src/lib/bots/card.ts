/**
 * A bot is a tree of cards, and this is the stored shape of it.
 *
 * Mirrors `Backend/src/bots/bot.card.ts` field for field: the editor writes
 * what the server validates and what the renderer sends. Two definitions exist
 * because the two runtimes share no module system — but they must never
 * disagree, so a change here is a change there.
 *
 * Deliberately just data. Nothing here calls the API or draws anything.
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

export type BotActionKind = BotAction["kind"];

export interface BotButton {
  /**
   * Stable for the life of the card, and what a tap is routed by. The label is
   * not: renaming "Drinks" to "Beverages" must not break a flow.
   */
  id: string;
  label: string;
  action: BotAction;
}

export interface BotCard {
  id: string;
  /** The card's own name, shown as the header when the card has no pictures. */
  title: string;
  /**
   * Public URLs, in the order the customer receives them.
   *
   * WhatsApp has no album: one picture and an interactive card means the
   * picture is that bubble's header, and everything else travels as its own
   * image message before the card. Meta fetches these, so none may be a
   * local path.
   */
  imageUrls: string[];
  /** The information itself: the body of the message. */
  info: string;
  /** In the order the customer sees them. */
  buttons: BotButton[];
}

/**
 * "When the customer says this, send that."
 *
 * The reply is a card of the same flow, so a rule is a trigger list and a
 * pointer — never a second copy of a message that could drift from the card the
 * business edits.
 */
export interface BotRule {
  id: string;
  /** Words or short phrases. Any one of them fires the rule. */
  triggers: string[];
  /** The card of this flow that goes out. */
  replyCardId: string;
  enabled: boolean;
}

/** Where the bot starts. */
export interface BotFlow {
  id: string;
  /** Null means the bot has no entry card and cannot greet anyone yet. */
  rootCardId: string | null;
  cards: BotCard[];
  /** Tried in order: the first rule that matches answers. */
  rules: BotRule[];
}

/** What `GET /v1/agents/:id/bot` answers with. */
export interface BotView {
  flow: BotFlow;
  /** False until an owner saves this flow for the first time. */
  stored: boolean;
}

/**
 * An id that is unique inside one flow and survives a round trip.
 *
 * Not a UUID: the id is opaque everywhere it is used (tap routing compares it
 * with itself), and a short readable one makes a stored flow legible while
 * debugging.
 */
export function newBotId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyFlow(agentId: string): BotFlow {
  return { id: agentId, rootCardId: null, cards: [], rules: [] };
}

export function newCard(): BotCard {
  return {
    id: newBotId("card"),
    title: "",
    imageUrls: [],
    info: "",
    buttons: [],
  };
}

export function newButton(): BotButton {
  return { id: newBotId("btn"), label: "", action: { kind: "handoff" } };
}

/** A rule with nothing typed yet, already pointing at a card that exists. */
export function newRule(replyCardId: string): BotRule {
  return { id: newBotId("rule"), triggers: [], replyCardId, enabled: true };
}

/**
 * The trigger box is one text field: "hi, hello, hey".
 *
 * Commas and newlines both separate, so a pasted list works, and blank entries
 * disappear instead of becoming a trigger that can never fire.
 */
export function triggersOf(text: string): string[] {
  return text
    .split(/[,\n]/u)
    .map((trigger) => trigger.trim())
    .filter((trigger) => trigger.length > 0);
}

/** The same list back as one editable line. */
export function triggerText(rule: BotRule): string {
  return rule.triggers.join(", ");
}

/**
 * The buttons a customer can actually see. A blank label is not a button the
 * customer was offered, so it is not one they can pick — the same rule the
 * server's renderer applies.
 */
export function shownButtons(card: BotCard): BotButton[] {
  return card.buttons.filter((button) => button.label.trim().length > 0);
}

/** The card the bot starts on, when the entry card still exists. */
export function rootOf(flow: BotFlow): BotCard | null {
  if (!flow.rootCardId) return null;

  return flow.cards.find((card) => card.id === flow.rootCardId) ?? null;
}

/** What a button's action points at, in one line, for the card list. */
export function actionSummary(action: BotAction, flow: BotFlow): string {
  switch (action.kind) {
    case "card": {
      const target = flow.cards.find((card) => card.id === action.cardId);
      return `Open ${target?.title.trim() || "a card that was removed"}`;
    }
    case "link":
      return action.url.trim() || "Open a link";
    case "handoff":
      return "Hand off to a person";
    case "text":
      return "Answer with a sentence";
  }
}
