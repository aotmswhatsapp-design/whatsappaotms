import type { ContextChunk } from "./context-chunk";
import { TOP_K } from "./limits";

export { TOP_K } from "./limits";

/**
 * Below this a match is noise. It is deliberately low: a fixed threshold is
 * model- and corpus-dependent, and a high one would silently refuse questions
 * the material does answer. The floor only drops near-zero matches.
 */
export const FLOOR = 0.25;

/**
 * The second, wider look, taken only when the strict one found nothing.
 *
 * A one- or two-word question — "price", "delivery" — embeds close to the
 * middle of the corpus, so the chunk that does answer it can be the nearest
 * neighbour and still score under `FLOOR`. Reading more rows costs one wider
 * index scan. It is the threshold, not the limit, that was discarding the
 * answer: raising the limit alone would have returned more rows under the
 * same floor and still filtered them all away.
 */
export const RETRY_K = 12;

/**
 * Low enough to keep a short query's real match, high enough to drop noise:
 * unrelated text sits around 0.0–0.1 with this model, so 0.15 is a floor for
 * "perhaps relevant" rather than a claim of a good match.
 */
export const RETRY_FLOOR = 0.15;

/**
 * Which rows reach the prompt, as one pure decision so the bounds can be tested
 * without a database.
 *
 * The two passes are ordered, not blended: when anything clears `FLOOR` the
 * strict result is returned untouched, and the wider threshold is consulted
 * only when it would otherwise be empty. That makes the change monotone — no
 * question that answers today is handed different material — and it confines
 * the weaker chunks to the questions that used to be refused before the model
 * ever saw them.
 */
export function rank(rows: ContextChunk[]): ContextChunk[] {
  const strict = rows.filter((row) => row.score >= FLOOR).slice(0, TOP_K);
  if (strict.length > 0) return strict;

  return rows
    .filter((row) => row.score >= RETRY_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, RETRY_K);
}
