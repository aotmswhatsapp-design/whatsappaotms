import type { BotCard, BotFlow, BotRule } from "./bot.card";
import { BODY_CHARS, MAX_LIST_ROWS, TEXT_CHARS } from "./bot.limits";
import { wordsOf } from "./bot.rules";

/**
 * The most cards one flow may hold.
 *
 * Not Meta's number — a flow is browsed, not sent whole. It is the list limit
 * because that is how many choices a customer can be shown at once without the
 * renderer falling back to numbered text, and a builder that lets you author a
 * flow no screen can present is a trap.
 */
export const MAX_CARDS = MAX_LIST_ROWS;

/**
 * A flow that exists and holds nothing.
 *
 * The id is the agent's: one flow per agent is the storage rule (a unique index
 * on `agent_id`), so the flow's identity cannot drift from the agent's.
 */
export function emptyFlow(agentId: string): BotFlow {
  return { id: agentId, rootCardId: null, cards: [], rules: [] };
}

/**
 * The reason this flow cannot be saved, or `null` when it can.
 *
 * A sentence rather than an exception so the same check can be a form message
 * and a refusal. Everything here is a dead end a customer could walk into:
 * a button that points at a card nobody wrote, an entry card that is not in the
 * flow, two buttons whose ids route to different cards.
 */
export function flowProblem(flow: BotFlow): string | null {
  if (flow.cards.length > MAX_CARDS) {
    return `A flow holds at most ${MAX_CARDS} cards. Split the rest into another agent.`;
  }

  const cardIds = new Set<string>();

  for (const card of flow.cards) {
    if (cardIds.has(card.id)) {
      return `Two cards share the id ${card.id}.`;
    }

    cardIds.add(card.id);
  }

  if (flow.rootCardId !== null && !cardIds.has(flow.rootCardId)) {
    return "The entry card is not part of this flow.";
  }

  for (const card of flow.cards) {
    const problem = cardProblem(card, cardIds);

    if (problem) return problem;
  }

  const ruleIds = new Set<string>();

  for (const rule of flow.rules) {
    if (ruleIds.has(rule.id)) {
      return `Two rules share the id ${rule.id}.`;
    }

    ruleIds.add(rule.id);

    const problem = ruleProblem(rule, cardIds);

    if (problem) return problem;
  }

  return null;
}

/**
 * A rule nobody could ever fire, or one whose card was deleted.
 *
 * Both are silent in production — the rule simply never answers — which is
 * exactly the kind of dead configuration that is worth refusing at save time.
 */
function ruleProblem(rule: BotRule, cardIds: Set<string>): string | null {
  const triggers = rule.triggers.filter((trigger) => wordsOf(trigger).length > 0);

  if (triggers.length === 0) {
    return "A rule has no trigger, so no customer message can ever fire it.";
  }

  if (!cardIds.has(rule.replyCardId)) {
    return "A rule replies with a card that is not part of this flow.";
  }

  return null;
}

function cardProblem(card: BotCard, cardIds: Set<string>): string | null {
  const named = card.title.trim() || card.id;

  if (card.info.length > BODY_CHARS) {
    return `"${named}" is longer than ${BODY_CHARS} characters.`;
  }

  const buttonIds = new Set<string>();

  for (const button of card.buttons) {
    if (buttonIds.has(button.id)) {
      return `Two buttons on "${named}" share the id ${button.id}.`;
    }

    buttonIds.add(button.id);

    if (button.action.kind === "card" && !cardIds.has(button.action.cardId)) {
      return `"${named}" points at a card that is not in this flow.`;
    }

    if (
      button.action.kind === "card" &&
      // A card that only opens itself is a loop with no way out.
      button.action.cardId === card.id
    ) {
      return `"${named}" has a button that opens itself.`;
    }

    if (button.action.kind === "text" && button.action.body.length > TEXT_CHARS) {
      return `A fixed reply on "${named}" is longer than ${TEXT_CHARS} characters.`;
    }
  }

  return null;
}
