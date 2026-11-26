import assert from "node:assert/strict";
import { test } from "node:test";

import { CHUNK_CHARS, chunkBlocks } from "./knowledge.chunk";

test("two small pages are never merged into one chunk", () => {
  const chunks = chunkBlocks([{ text: "alpha", page: 1 }, { text: "beta", page: 2 }]);

  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map((chunk) => chunk.page), [1, 2]);
});

test("a long page splits, and every piece keeps the page number", () => {
  const chunks = chunkBlocks([{ text: "x".repeat(CHUNK_CHARS * 2), page: 7 }]);

  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.page === 7));
});

test("prose without pages packs together up to the cap", () => {
  // Two blocks that fit inside one chunk, and a third that cannot: 1,000 + 2 +
  // 1,000 fits the cap, adding another 1,000 does not.
  const chunks = chunkBlocks([{ text: "a".repeat(1_000) }, { text: "b".repeat(1_000) }]);

  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].text.length <= CHUNK_CHARS);

  const fuller = chunkBlocks([
    { text: "a".repeat(1_000) },
    { text: "b".repeat(1_000) },
    { text: "c".repeat(1_000) },
    { text: "d".repeat(1_000) },
  ]);

  assert.ok(fuller.length > 1);
  assert.ok(fuller.every((chunk) => chunk.text.length <= CHUNK_CHARS));
});

test("table blocks are one chunk each, with their own row range", () => {
  const chunks = chunkBlocks([
    { text: "Columns: a\n1", sheet: "CSV", rowFrom: 1, rowTo: 1 },
    { text: "Columns: a\n2", sheet: "CSV", rowFrom: 2, rowTo: 2 },
  ]);

  assert.deepEqual(chunks.map((chunk) => [chunk.rowFrom, chunk.rowTo]), [[1, 1], [2, 2]]);
});

test("a heading starts a new chunk so it is not buried mid-chunk", () => {
  const chunks = chunkBlocks([
    { text: "Intro", heading: "Welcome" },
    { text: "Terms", heading: "Rules" },
  ]);

  assert.deepEqual(chunks.map((chunk) => chunk.heading), ["Welcome", "Rules"]);
});
