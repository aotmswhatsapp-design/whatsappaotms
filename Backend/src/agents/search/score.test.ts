import assert from "node:assert/strict";
import { test } from "node:test";

import type { ContextChunk } from "./context-chunk";
import { TOP_K } from "./limits";
import { confidenceOf, selectRelevant, type LocalHit } from "./score";

const chunk = (id: string, score = 0): ContextChunk => ({
  id,
  text: "body",
  sourceId: "s",
  title: "Price list",
  mime: null,
  score,
  page: null,
  sheet: null,
  rowFrom: null,
  rowTo: null,
  heading: null,
});

const hit = (id: string, over: Partial<LocalHit> = {}): LocalHit => ({
  chunk: chunk(id),
  allTerms: false,
  someTerms: false,
  rank: 0,
  similarity: 0,
  ...over,
});

test("every term present outranks one term, at any rank", () => {
  const every = confidenceOf({ allTerms: true, someTerms: true, rank: 0, similarity: 0 });
  const one = confidenceOf({ allTerms: false, someTerms: true, rank: 1_000, similarity: 1 });

  assert.ok(every > one);
});

test("one term present outranks similarity alone, at any similarity", () => {
  const one = confidenceOf({ allTerms: false, someTerms: true, rank: 0, similarity: 0 });
  const similar = confidenceOf({ allTerms: false, someTerms: false, rank: 0, similarity: 1 });

  assert.ok(one > similar);
});

test("every confidence stays on the 0–1 scale the citation badge shows", () => {
  for (const rank of [0, 0.1, 1, 7, 1_000]) {
    for (const similarity of [0, 0.5, 1]) {
      for (const [allTerms, someTerms] of [
        [true, true],
        [false, true],
        [false, false],
      ]) {
        const score = confidenceOf({ allTerms, someTerms, rank, similarity });
        assert.ok(score >= 0 && score <= 1, `${score} is off the scale`);
      }
    }
  }
});

test("a chunk found only by similarity has to clear the floor", () => {
  const kept = selectRelevant([hit("weak", { similarity: 0.6 })], 0.5);
  const dropped = selectRelevant([hit("noise", { similarity: 0.4 })], 0.5);

  assert.deepEqual(kept.map((row) => row.id), ["weak"]);
  assert.deepEqual(dropped, []);
});

test("a chunk that matched a word is kept whatever its similarity", () => {
  // The word being there is evidence a similarity floor cannot supply: a
  // one-word question scores low against a whole chunk and still answers it.
  assert.deepEqual(
    selectRelevant([hit("some", { someTerms: true, similarity: 0.01 })], 0.9).map(
      (row) => row.id,
    ),
    ["some"],
  );
});

test("the result is ordered by confidence, not by the order it arrived", () => {
  const rows = selectRelevant(
    [
      hit("similar", { similarity: 0.9 }),
      hit("one", { someTerms: true, rank: 1 }),
      hit("every", { allTerms: true, someTerms: true, rank: 1 }),
    ],
    0.5,
  );

  assert.deepEqual(rows.map((row) => row.id), ["every", "one", "similar"]);
});

test("the list is capped at the number of chunks one answer can carry", () => {
  const rows = Array.from({ length: TOP_K + 4 }, (_, at) =>
    hit(`c-${at}`, { someTerms: true }),
  );

  assert.equal(selectRelevant(rows, 0.5).length, TOP_K);
});

test("the confidence replaces the placeholder the query left behind", () => {
  const [row] = selectRelevant([hit("c", { allTerms: true, rank: 1 })], 0.5);

  assert.ok(row.score > 0.85);
});
