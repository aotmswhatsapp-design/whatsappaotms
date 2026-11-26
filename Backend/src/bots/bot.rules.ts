import type { BotCard, BotFlow, BotRule } from "./bot.card";

/**
 * Matching is on words, not characters.
 *
 * Every run of punctuation or whitespace becomes one space, so "HI!!" and
 * "hi there" both carry the word `hi`, while `this` does not — a short trigger
 * that fired inside another word would answer messages the business never meant
 * to catch. NFKC folds the composed forms first, so an accent or a full-width
 * character reaches the same rule.
 */
const NOT_WORD = /[^\p{L}\p{N}]+/gu;

/** The words of a message, lowercased, punctuation removed, single-spaced. */
export function wordsOf(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(NOT_WORD, " ").trim();
}

/**
 * Does this message contain one of these triggers, as whole words?
 *
 * The padding is what makes it a word match: without the surrounding spaces,
 * `hi` would be found inside `this`. A trigger that is a phrase matches a
 * phrase, so "good morning" fires on "good morning!" and not on "morning".
 */
export function matchesTrigger(
  message: string,
  triggers: readonly string[],
): boolean {
  const words = wordsOf(message);

  if (words.length === 0) return false;

  const padded = ` ${words} `;

  return triggers.some((trigger) => {
    const needle = wordsOf(trigger);

    return needle.length > 0 && padded.includes(` ${needle} `);
  });
}

/**
 * The rule that answers this message, and the card it sends.
 *
 * First match in stored order, because a business orders its rules the way it
 * wants precedence: "complaint" above "hi" is how a complaint stops being
 * greeted. A disabled rule, a rule whose triggers are all blank, and a rule
 * whose card is gone are each simply not an answer — the message falls through
 * to the next rule and then to the knowledge base.
 */
export function ruleReply(
  flow: BotFlow,
  message: string,
): { rule: BotRule; card: BotCard } | null {
  for (const rule of flow.rules) {
    if (!rule.enabled) continue;
    if (!matchesTrigger(message, rule.triggers)) continue;

    const card = flow.cards.find((row) => row.id === rule.replyCardId);

    if (card) return { rule, card };
  }

  return null;
}
