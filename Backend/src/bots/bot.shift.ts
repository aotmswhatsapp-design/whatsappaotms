import type { BotCard, BotButton, BotFlow } from "./bot.card";
import { MAX_CARDS } from "./bot.flow";

/**
 * Carrying cards from one agent's bot to another's.
 *
 * A card is not a message. It is a step that other steps point at, and its id
 * is what a tap under an already-sent card is routed by, so a shift cannot be a
 * `splice` here and a `push` there: every reference to the card has to be
 * answered for — on both sides — or one of the two flows comes out in a shape
 * `flowProblem` refuses to save.
 *
 * Two decisions are made for the owner rather than asked, because there is no
 * honest alternative:
 *
 * - A button whose card stays behind becomes a handoff. The card is not in this
 *   flow any more, and a `card` action may not point outside it. Handing off is
 *   the one landing that cannot be wrong.
 * - A keyword rule whose card leaves is removed, not disabled. The stored shape
 *   has no rule without a card (`replyCardId` is not nullable, and a rule that
 *   replies with nothing can never answer), and re-pointing it at some other
 *   card would silently change what a customer receives. This is what deleting
 *   a card already does.
 *
 * Shifted cards always get a fresh id, in both modes. An id is only unique
 * inside one flow, so a card that kept its own could collide with the target's
 * and be refused; re-iding is also what lets a copy and its original be edited
 * without dragging each other along.
 */

/** Move takes the cards out of the source; copy leaves the source as it was. */
export type ShiftMode = "move" | "copy";

/** What was given up to make both flows valid again. */
export interface ShiftRepairs {
  /** Buttons on the cards left behind that now hand off to a person. */
  sourceButtons: number;
  /** Keyword rules dropped because the card they replied with left the flow. */
  sourceRules: number;
  /** Buttons on the shifted cards that now hand off, their card staying behind. */
  targetButtons: number;
}

export interface ShiftInput {
  source: BotFlow;
  target: BotFlow;
  /** The cards to carry, by the ids they hold in `source`. */
  cardIds: readonly string[];
  mode: ShiftMode;
  /** A new card id. Injected so the transformation stays a pure function. */
  newId: () => string;
}

export type ShiftOutcome =
  | { ok: true; source: BotFlow; target: BotFlow; repairs: ShiftRepairs }
  | { ok: false; reason: string };

export function shiftCards(input: ShiftInput): ShiftOutcome {
  // A repeated id would move the same card twice and dupe it in the target.
  // Dropped rather than refused: the second copy is the same request.
  const wanted = [...new Set(input.cardIds)];

  if (wanted.length === 0) {
    return { ok: false, reason: "Choose at least one card to shift." };
  }

  const moving: BotCard[] = [];

  for (const id of wanted) {
    const card = input.source.cards.find((row) => row.id === id);

    if (!card) {
      return {
        ok: false,
        reason:
          "One of the cards you chose is no longer part of this flow. Reload and try again.",
      };
    }

    moving.push(card);
  }

  // The target is the flow that has to hold them, so its ceiling is the one
  // that counts. Named with both numbers: "the limit" alone leaves the owner
  // guessing how far over they are.
  if (input.target.cards.length + moving.length > MAX_CARDS) {
    return {
      ok: false,
      reason: `The other bot already holds ${input.target.cards.length} cards. ${moving.length} more would pass the ${MAX_CARDS}-card limit.`,
    };
  }

  // Every id either flow uses now, so a fresh one cannot collide with a card
  // that is staying — including the source's own cards in copy mode.
  const taken = new Set(
    [...input.source.cards, ...input.target.cards].map((card) => card.id),
  );
  const renamed = new Map<string, string>();

  for (const card of moving) {
    let id = input.newId();

    while (taken.has(id)) id = input.newId();

    taken.add(id);
    renamed.set(card.id, id);
  }

  const repairs: ShiftRepairs = {
    sourceButtons: 0,
    sourceRules: 0,
    targetButtons: 0,
  };

  const carried = moving.map((card) => ({
    ...card,
    id: renamed.get(card.id) ?? card.id,
    buttons: card.buttons.map((button) => {
      if (button.action.kind !== "card") return button;

      const moved = renamed.get(button.action.cardId);

      if (moved) {
        return retarget(button, { kind: "card", cardId: moved });
      }

      repairs.targetButtons += 1;

      return retarget(button, { kind: "handoff" });
    }),
  }));

  const target: BotFlow = {
    ...input.target,
    // A target that has never had an entry takes the first card carried in,
    // the way the builder does when the first card is added to an empty flow.
    // A target that has one keeps it: the entry is where *its* customers land.
    rootCardId: input.target.rootCardId ?? carried[0]?.id ?? null,
    cards: [...input.target.cards, ...carried],
  };

  if (input.mode === "copy") {
    return { ok: true, source: input.source, target, repairs };
  }

  const leaving = new Set(wanted);

  const source: BotFlow = {
    ...input.source,
    rootCardId:
      input.source.rootCardId !== null && leaving.has(input.source.rootCardId)
        ? null
        : input.source.rootCardId,
    cards: input.source.cards
      .filter((card) => !leaving.has(card.id))
      .map((card) => ({
        ...card,
        buttons: card.buttons.map((button) => {
          if (button.action.kind !== "card" || !leaving.has(button.action.cardId)) {
            return button;
          }

          repairs.sourceButtons += 1;

          return retarget(button, { kind: "handoff" });
        }),
      })),
    rules: input.source.rules.filter((rule) => {
      if (!leaving.has(rule.replyCardId)) return true;

      repairs.sourceRules += 1;

      return false;
    }),
  };

  return { ok: true, source, target, repairs };
}

/** The same button with a different action, so nothing else about it moves. */
function retarget(button: BotButton, action: BotButton["action"]): BotButton {
  return { ...button, action };
}
