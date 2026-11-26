import type { ContextChunk } from "./context-chunk";
import { TOP_K } from "./limits";

/** What the database says about one chunk, before a confidence is put on it. */
export interface LocalHit {
  chunk: ContextChunk;
  /** The chunk contains every term the question has. */
  allTerms: boolean;
  /** The chunk contains at least one of them. */
  someTerms: boolean;
  /** `ts_rank_cd`: higher is better, with no fixed ceiling. */
  rank: number;
  /** `word_similarity`: 0 to 1. */
  similarity: number;
}

/**
 * One confidence per chunk, on a 0–1 scale the citation badge can show.
 *
 * This is **not** cosine and must never be compared with the floors in
 * `vector.rank.ts`. A full-text match and a similarity score are different
 * kinds of evidence, so they are layered rather than blended:
 *
 * - every term present     0.85 … 1.00
 * - some term present      0.55 … 0.85
 * - similarity only        0.00 … 0.50
 *
 * The bands touch but never overlap, which is what keeps the ordering honest:
 * a chunk that matched more of the question can never be pushed below one that
 * matched less of it, whatever the ranker happened to return.
 */
export function confidenceOf(hit: Omit<LocalHit, "chunk">): number {
  // `rank / (rank + 1)` maps an unbounded rank into 0–1 without a corpus-wide
  // maximum to normalise against.
  const strength = hit.rank / (hit.rank + 1);

  if (hit.allTerms) return 0.85 + 0.15 * strength;
  if (hit.someTerms) return 0.55 + 0.15 * strength + 0.15 * hit.similarity;

  return 0.5 * hit.similarity;
}

/**
 * The rows that reach the composer.
 *
 * A chunk that matched a term is kept: the term being there at all is evidence
 * a similarity floor cannot supply. A chunk found only by trigram has to clear
 * `minSimilarity`, which is why the threshold is a setting rather than a
 * constant — it depends on how a corpus is written, not on the model.
 */
export function selectRelevant(
  hits: LocalHit[],
  minSimilarity: number,
): ContextChunk[] {
  return hits
    .filter(
      (hit) => hit.allTerms || hit.someTerms || hit.similarity >= minSimilarity,
    )
    .map((hit) => ({ ...hit.chunk, score: confidenceOf(hit) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
}
