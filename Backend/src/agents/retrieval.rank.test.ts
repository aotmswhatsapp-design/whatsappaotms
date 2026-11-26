import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FLOOR,
  RETRY_FLOOR,
  RETRY_K,
  TOP_K,
  rank,
  type ContextChunk,
} from "./retrieval.service";

/** A chunk with only the fields `rank` reads made interesting. */
const chunk = (score: number): ContextChunk => ({
  id: `c-${score}`,
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

const scores = (chunks: ContextChunk[]): number[] => chunks.map((row) => row.score);

test("a lone match under the strict floor is kept by the wider pass", () => {
  assert.deepEqual(scores(rank([chunk(0.24), chunk(0.1)])), [0.24]);
});

test("the strict pass is returned untouched when it finds anything", () => {
  // 0.2 is above RETRY_FLOOR but below FLOOR: the relaxed grade must not be
  // mixed in once a strict match exists.
  assert.deepEqual(scores(rank([chunk(0.9), chunk(0.26), chunk(0.2)])), [0.9, 0.26]);
});

test("the strict pass keeps the order the index returned and stops at TOP_K", () => {
  const rows = Array.from({ length: 8 }, () => chunk(0.5));
  assert.equal(rank(rows).length, TOP_K);
});

test("a short query is answered from the wider floor when the strict one is empty", () => {
  assert.deepEqual(scores(rank([chunk(0.21), chunk(0.17), chunk(0.12)])), [0.21, 0.17]);
});

test("the wider pass is ordered by score, whatever order it was given", () => {
  assert.deepEqual(scores(rank([chunk(0.16), chunk(0.24), chunk(0.18)])), [
    0.24, 0.18, 0.16,
  ]);
});

test("the wider pass is still bounded", () => {
  const rows = Array.from({ length: 14 }, () => chunk(0.2));
  assert.equal(rank(rows).length, RETRY_K);
});

test("noise below the wider floor is still refused", () => {
  assert.deepEqual(rank([chunk(RETRY_FLOOR - 0.01)]), []);
});

test("no rows means no chunks, so the caller's no-context path still runs", () => {
  assert.deepEqual(rank([]), []);
});

test("the two floors are ordered, which is what keeps the passes from overlapping", () => {
  assert.ok(RETRY_FLOOR < FLOOR);
});
