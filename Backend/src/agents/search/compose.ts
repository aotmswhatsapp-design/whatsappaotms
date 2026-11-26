import type { ContextChunk } from "./context-chunk";
import { tokensOf } from "./normalize";

export interface ComposedAnswer {
  /** Sentences copied from the material, in the order they were written. */
  body: string;
  /** The chunks those sentences came from, in citation order. */
  used: ContextChunk[];
}

/** More than this many sentences is an essay, not a WhatsApp reply. */
const MAX_SENTENCES = 3;

interface Sentence {
  text: string;
  /** The sentence began a line in the source, so it begins one in the answer. */
  line: boolean;
}

interface Candidate extends Sentence {
  chunk: ContextChunk;
  chunkAt: number;
  sentenceAt: number;
  /** How many distinct words of the question the sentence contains. */
  hits: number;
}

/**
 * The answer, when the answer is a sentence somebody already wrote.
 *
 * This is the whole difference between an extractive engine and a generative
 * one: every character of `body` was copied from the business's own material,
 * so the reply cannot contain a price, a policy or a web address that nobody
 * configured. When no sentence shares a word with the question there is no
 * answer here — `null` sends the caller down its no-context path rather than
 * returning the closest-looking paragraph and hoping.
 *
 * The unit is the sentence, not the chunk. A 3,200-character chunk answers a
 * one-line question with one line of it; the rest is context the customer did
 * not ask for, and on WhatsApp it reads as a wall.
 */
export function composeAnswer(input: {
  question: string;
  chunks: ContextChunk[];
  maxChars: number;
}): ComposedAnswer | null {
  const wanted = new Set(tokensOf(input.question));

  // A greeting, or anything left after the stopwords were dropped, has no
  // subject to match on. The conversation engine owns that case.
  if (wanted.size === 0) return null;

  const candidates: Candidate[] = [];

  input.chunks.forEach((chunk, chunkAt) => {
    sentencesOf(chunk.text).forEach((sentence, sentenceAt) => {
      const hits = hitsIn(sentence.text, wanted);
      if (hits === 0) return;

      candidates.push({ ...sentence, chunk, chunkAt, sentenceAt, hits });
    });
  });

  if (candidates.length === 0) return null;

  // Most of the question first, then the material's own order for ties, so the
  // same question always produces the same answer.
  const best = candidates
    .slice()
    .sort(
      (a, b) =>
        b.hits - a.hits ||
        a.chunkAt - b.chunkAt ||
        a.sentenceAt - b.sentenceAt,
    )
    .slice(0, MAX_SENTENCES);

  // Chosen by relevance, printed in the order it was written.
  const chosen = best.sort(
    (a, b) => a.chunkAt - b.chunkAt || a.sentenceAt - b.sentenceAt,
  );

  // The best sentence is kept even if it alone overflows; the others only earn
  // their place if everything still fits.
  while (chosen.length > 1 && joined(chosen).length > input.maxChars) {
    chosen.pop();
  }

  const body = joined(chosen);

  // A single sentence longer than the budget is cut at a word boundary. Half a
  // sentence is still the business's words; an invented ending is not.
  const clipped =
    body.length > input.maxChars ? clip(body, input.maxChars) : body;

  if (clipped.length === 0) return null;

  return { body: clipped, used: cited(chosen) };
}

/** Distinct question words the sentence contains, folded the same way. */
function hitsIn(sentence: string, wanted: Set<string>): number {
  let hits = 0;

  for (const token of new Set(tokensOf(sentence))) {
    if (wanted.has(token)) hits += 1;
  }

  return hits;
}

/**
 * Sentences as the customer will read them.
 *
 * A blank line starts a new sentence in prose and a new row in a price list,
 * and both have to survive: joining a table into one line turns six prices
 * into an unreadable sentence.
 */
function sentencesOf(text: string): Sentence[] {
  const out: Sentence[] = [];

  for (const block of text.split(/\n+/u)) {
    block.split(/(?<=[.!?])\s+/u).forEach((part, index) => {
      const cleaned = part.replace(/\s+/gu, " ").trim();
      if (cleaned.length > 2) out.push({ text: cleaned, line: index === 0 });
    });
  }

  return out;
}

function joined(sentences: Sentence[]): string {
  return sentences
    .map((sentence, index) =>
      index === 0 || sentence.line ? `\n${sentence.text}` : ` ${sentence.text}`,
    )
    .join("")
    .trim();
}

/** The chunks that were quoted, once each, in the order they were read. */
function cited(sentences: Candidate[]): ContextChunk[] {
  const seen = new Set<string>();
  const out: ContextChunk[] = [];

  for (const sentence of sentences) {
    if (seen.has(sentence.chunk.id)) continue;
    seen.add(sentence.chunk.id);
    out.push(sentence.chunk);
  }

  return out;
}

/** Cut at the last word that fits; no word at all means no answer. */
function clip(text: string, maxChars: number): string {
  const head = text.slice(0, maxChars);
  const space = head.lastIndexOf(" ");

  return space > 0 ? head.slice(0, space).trim() : "";
}
