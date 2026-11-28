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

/** How WhatsApp classifies a file handed over with a card. */
export type CardFileKind = "document" | "video";

/**
 * A document or a video a card hands over, as its own WhatsApp message.
 *
 * WhatsApp has no attachment on an interactive message, so a file travels just
 * before the card — one message per file, in this order, the way extra
 * pictures do.
 */
export interface CardFile {
  /** Permanent public address; Meta fetches it when the card is sent. */
  url: string;
  /** What the customer's phone calls the download, extension included. */
  name: string;
  kind: CardFileKind;
}

export interface BotCard {
  id: string;
  /**
   * What the business calls this card: "Welcome", "Pricing menu", "Support".
   *
   * Internal, and never sent. It is how the card list, the pickers and the
   * buttons that open the card name it, so renaming a card changes nothing the
   * customer reads — which is the whole reason it exists apart from `title`.
   */
  name: string;
  /**
   * The heading the customer reads: the header when there is no picture, or
   * when the pictures travel separately.
   */
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
  /**
   * Documents and videos handed over with this card, in the order the customer
   * receives them. Each is sent as its own message before the card.
   */
  files: CardFile[];
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
    name: "",
    title: "",
    imageUrls: [],
    files: [],
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

/**
 * The cards, in the order these ids name them.
 *
 * A drag in the card list produces a new sequence of ids, and this turns it
 * back into cards. The order is the editor's own: a card is reached by the
 * button that points at it and the entry is `rootCardId`, so moving one reorders
 * the list and nothing a customer receives.
 *
 * An ids list that is not a permutation of the cards — a stale drag, a card
 * added mid-gesture — is refused rather than applied. A reorder must never be
 * able to drop a card.
 */
export function reorderCards(
  cards: BotCard[],
  ids: readonly string[],
): BotCard[] {
  if (ids.length !== cards.length || new Set(ids).size !== cards.length) {
    return cards;
  }

  const byId = new Map(cards.map((card) => [card.id, card]));

  const ordered = ids
    .map((id) => byId.get(id))
    .filter((card): card is BotCard => card !== undefined);

  return ordered.length === cards.length ? ordered : cards;
}

/**
 * The line a card is called by, wherever the business reads one: the card list,
 * the editor's heading, and every picker that points at a card.
 *
 * The name only. A card that has not been named yet says so rather than
 * showing a heading the owner may not think of as the card's name; the
 * server fills in the heading of a card saved before names existed, so those
 * keep the label they have always had.
 */
export function cardLabel(card: BotCard): string {
  return card.name.trim() || "Untitled card";
}

/** What shifting these cards would change, before it happens. */
export interface ShiftImpact {
  /** Buttons on the cards staying behind that opened one of these. */
  sourceButtons: number;
  /** Keyword rules whose card is one of these. */
  sourceRules: number;
  /** Buttons on the moving cards that open a card staying behind. */
  targetButtons: number;
  /** True when the entry card is among them, so this flow will have none. */
  entryMoves: boolean;
  /** Cards that would be left behind. */
  remaining: number;
}

/**
 * What a shift to another agent would give up, for the confirmation step.
 *
 * Advisory: the server decides, from the flows it reads at the moment of the
 * shift. It exists so the confirmation can say what will be repaired instead of
 * asking the owner to find out afterwards, and it mirrors
 * `Backend/src/bots/bot.shift.ts` — a change in what a shift repairs is a change
 * here too.
 *
 * The rules are counted for a move only: in a copy the card stays, so its rule
 * still has something to send.
 */
export function shiftImpact(
  flow: BotFlow,
  cardIds: readonly string[],
  mode: "move" | "copy",
): ShiftImpact {
  const moving = new Set(cardIds);
  const impact: ShiftImpact = {
    sourceButtons: 0,
    sourceRules: 0,
    targetButtons: 0,
    entryMoves: flow.rootCardId !== null && moving.has(flow.rootCardId),
    remaining: flow.cards.filter((card) => !moving.has(card.id)).length,
  };

  for (const card of flow.cards) {
    const leaves = moving.has(card.id);

    for (const button of card.buttons) {
      if (button.action.kind !== "card") continue;

      const opens = moving.has(button.action.cardId);

      // A button on a card that stays, opening a card that leaves, is the
      // source's repair. A button on a card that leaves, opening a card that
      // stays, is the target's — the same pair of facts, two sides.
      if (leaves && !opens) impact.targetButtons += 1;
      if (!leaves && opens) impact.sourceButtons += 1;
    }
  }

  if (mode === "move") {
    impact.sourceRules = flow.rules.filter((rule) =>
      moving.has(rule.replyCardId),
    ).length;
  }

  return impact;
}

/** What a button's action points at, in one line, for the card list. */
export function actionSummary(action: BotAction, flow: BotFlow): string {
  switch (action.kind) {
    case "card": {
      const target = flow.cards.find((card) => card.id === action.cardId);
      return target ? `Open ${cardLabel(target)}` : "Open a card that was removed";
    }
    case "link":
      return action.url.trim() || "Open a link";
    case "handoff":
      return "Hand off to a person";
    case "text":
      return "Answer with a sentence";
  }
}
