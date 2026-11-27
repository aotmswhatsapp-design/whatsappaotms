import type { LeadInterest } from "@prisma/client";

import { wordsOf } from "../bots/bot.rules";

/**
 * The stage a conversation carries before and after a message, plus the
 * evidence for the last verdict: the previous inbound body is what makes the
 * sticky rules below possible without a second column, and the stored reason
 * keeps the profile that set a refusal alive across replies that carry it.
 */
export interface InterestState {
  stage: LeadInterest;
  score: number | null;
  body: string | null;
  /** `Conversation.interestReason`, when the caller has it. Optional so a
   * caller with nothing stored can still classify. */
  reason?: string | null;
}

export interface InterestVerdict {
  interest: LeadInterest;
  score: number;
  /** Names the deciding phrase, the absence of one, or a carried-over score. */
  reason: string;
}

export type ProfileKey = "STOP" | "REFUSAL" | "SOFT_NO" | "BUYING" | "CONTACT" | "URGENCY";

interface Profile {
  readonly key: ProfileKey;
  readonly weight: number;
  readonly phrases: readonly string[];
}

/**
 * Ordered strongest-refusal first: a message that both refuses and asks a price
 * ("not interested in the price") is a refusal, not a sale.
 *
 * English plus the transliterated Hinglish the same conversations carry. The
 * list is the tuning surface: a wrong guess is fixed here, not in the intake.
 */
const PROFILES: readonly Profile[] = [
  {
    key: "STOP",
    weight: -4,
    phrases: [
      "stop messaging",
      "stop sending",
      "do not message",
      "don't message",
      "remove my number",
      "remove me",
      "unsubscribe",
      "stop",
    ],
  },
  {
    key: "REFUSAL",
    weight: -3,
    phrases: [
      "not interested",
      "no interest",
      "already bought",
      "already have",
      "no need",
      "not required",
      "wrong number",
      "nahi chahiye",
    ],
  },
  {
    key: "SOFT_NO",
    weight: -1,
    phrases: [
      "not now",
      "not available",
      "maybe later",
      "busy",
      "will think",
      "think about it",
      "sochna",
    ],
  },
  {
    key: "BUYING",
    weight: 3,
    phrases: [
      "how much",
      "rate kya",
      "kitna",
      "price",
      "cost",
      "rate",
      "quote",
      "quotation",
      "available",
      "stock",
      "demo",
      "sample",
      "catalogue",
      "brochure",
      "order",
      "subscribe",
      "details",
      "chahiye",
    ],
  },
  {
    key: "CONTACT",
    weight: 2,
    phrases: ["call me", "send me", "my number", "email me", "contact me"],
  },
  {
    key: "URGENCY",
    weight: 1,
    phrases: ["today", "now", "urgent", "asap"],
  },
];

const NEGATIVE: ReadonlySet<ProfileKey> = new Set(["STOP", "REFUSAL", "SOFT_NO"]);

/** Score at or above this is a lead; at or below its negation, a no. */
export const THRESHOLD = 3;

export const NO_SIGNAL = "no buying or refusal signal";
export const MANUAL_REASON = "manual";

const CARRIED = "carried over: ";

const CURRENCY = /[₹$]|\b(?:rs|inr|aed)\b/iu;
const QUANTITY = /\d+\s*(?:pcs?|pieces?|boxes?|box|kg|units?|nos)\b/iu;

/**
 * Words that mean something else next to a buying word: "out of order" is a
 * broken device, not a purchase. Removed before matching so the profile table
 * stays readable.
 */
const NON_SIGNALS: readonly string[] = ["out of order"];

/**
 * A bare "stop" beside "by", "over" or "in" is a visit — "stop by today to
 * order a sample" — not an opt-out. Each occurrence is judged on its own, so
 * "stop by; stop" still counts, and an imperative such as "stop at once" is
 * never read as a visit.
 */
const VISIT_STOP = / stop (?:by|over|in)\b/gu;

function hasBareStop(padded: string): boolean {
  return padded.replace(VISIT_STOP, " __excluded__ ").includes(" stop ");
}

interface Hit {
  profile: Profile;
  phrase: string;
}

function hitsOf(body: string): Hit[] {
  const words = wordsOf(body);
  if (!words) return [];

  const padded = NON_SIGNALS.reduce(
    (text, phrase) => text.replace(` ${phrase} `, " __excluded__ "),
    ` ${words} `,
  );
  // Masked, not removed: deleting the phrase would join the words on either
  // side and manufacture a trigger that was never adjacent.
  const bareStop = hasBareStop(padded);
  const hits: Hit[] = [];

  for (const profile of PROFILES) {
    let best: string | null = null;

    for (const phrase of profile.phrases) {
      const needle = wordsOf(phrase);
      if (!needle || !padded.includes(` ${needle} `)) continue;
      if (needle === "stop" && !bareStop) continue;
      if (best === null || needle.length > best.length) best = needle;
    }

    if (best !== null) hits.push({ profile, phrase: best });
  }

  return hits;
}

/** The group that decides the message: any refusal outranks every positive. */
function decidingOf(hits: readonly Hit[]): Hit[] {
  const negatives = hits.filter((hit) => NEGATIVE.has(hit.profile.key));
  return negatives.length > 0 ? negatives : [...hits];
}

function strongest(hits: readonly Hit[]): Hit {
  return hits.reduce((best, hit) =>
    Math.abs(hit.profile.weight) > Math.abs(best.profile.weight) ? hit : best,
  );
}

/** Structural evidence, capped at +3: a question, a currency, a quantity. */
function structuralOf(body: string): number {
  return (body.includes("?") ? 1 : 0) + (CURRENCY.test(body) ? 1 : 0) + (QUANTITY.test(body) ? 1 : 0);
}

function clamp(score: number): number {
  return Math.max(-100, Math.min(100, score));
}

function stageOf(score: number): LeadInterest {
  if (score >= THRESHOLD) return "INTERESTED";
  if (score <= -THRESHOLD) return "NOT_INTERESTED";
  return "UNKNOWN";
}

/** The profile the last deciding message belonged to, re-read from its body. */
function profileOf(body: string | null): ProfileKey | null {
  if (!body) return null;

  const hits = hitsOf(body);
  return hits.length > 0 ? strongest(decidingOf(hits)).profile.key : null;
}

const PROFILE_IN_REASON = /\((STOP|REFUSAL|SOFT_NO|BUYING|CONTACT|URGENCY)\)$/u;

/**
 * The profile behind the stored stage. The stored reason names it outright;
 * the body is the fallback for a caller that has no reason to pass. Reading
 * only the body loses a STOP the moment one neutral reply carries it.
 */
function originOf(previous: InterestState): ProfileKey | null {
  const stored = previous.reason?.trim().match(PROFILE_IN_REASON);
  if (stored) return stored[1] as ProfileKey;

  return profileOf(previous.body);
}

/**
 * The reason for a message that moved nothing. It names the profile that set
 * the stage, under one prefix however many replies carry it, so the stored
 * string stays short and stays readable by `originOf`.
 */
function carriedReason(previous: InterestState): string {
  const stored = previous.reason?.trim();
  if (!stored) return NO_SIGNAL;

  return stored.startsWith(CARRIED) ? stored : `${CARRIED}${stored}`;
}

/**
 * Reads one inbound message against the thread's stored stage.
 *
 * The score is this message's evidence, not a running total: a running total
 * would need a second threshold to undo a refusal that arrived after three
 * buying questions, and the spec's stickiness rules assume per-message
 * evidence. The stored score is what the last deciding message found.
 */
export function classify(body: string, previous: InterestState): InterestVerdict {
  const hits = hitsOf(body);
  const words = wordsOf(body).split(" ").filter(Boolean);
  const carried = clamp(previous.score ?? 0);

  // No phrase at all: the message can only keep what the thread had. A short
  // reply is the reason this rule exists — "how much?" → "₹200" → "ok" must
  // stay a lead — and a long message without a signal must never move a stage
  // backwards. The one exception is a long message whose shape alone is a
  // signal (a question, a currency, a quantity).
  if (hits.length === 0) {
    const structural = words.length < 4 ? 0 : structuralOf(body);

    // Shape alone can make a lead, never lose or revive one: a bare question
    // must not demote an interested thread, and a stopped thread clears on a
    // buying phrase, never on a question.
    if (
      structural === 0 ||
      previous.stage === "NOT_INTERESTED" ||
      stageOf(structural) !== "INTERESTED"
    ) {
      return { interest: previous.stage, score: carried, reason: carriedReason(previous) };
    }

    return {
      interest: "INTERESTED",
      score: clamp(structural),
      reason: `structural signals (${structural})`,
    };
  }

  const deciding = decidingOf(hits);
  const negative = NEGATIVE.has(deciding[0].profile.key);
  const delta = negative
    ? deciding.reduce((sum, hit) => sum + hit.profile.weight, 0)
    : deciding.reduce((sum, hit) => sum + hit.profile.weight, 0) + structuralOf(body);

  const score = clamp(delta);
  const best = strongest(deciding);
  const reason = `matched "${best.phrase}" (${best.profile.key})`;

  // A fresh opt-out outranks whatever the thread carried: the "stop" just
  // typed is newer evidence than the refusal that set the stored stage.
  if (best.profile.key === "STOP") {
    return { interest: stageOf(score), score, reason };
  }

  // A refusal sticks until the customer asks to buy: one "ok" must not
  // resurrect somebody who asked to be left alone.
  if (previous.stage === "NOT_INTERESTED") {
    const origin = originOf(previous);

    if (origin === "STOP" && !hits.some((hit) => hit.profile.key === "BUYING")) {
      return { interest: "NOT_INTERESTED", score: carried, reason: carriedReason(previous) };
    }

    if (
      origin === "REFUSAL" &&
      !hits.some((hit) => hit.profile.key === "BUYING" || hit.profile.key === "CONTACT")
    ) {
      return { interest: "NOT_INTERESTED", score: carried, reason: carriedReason(previous) };
    }
  }

  return { interest: stageOf(score), score, reason };
}
