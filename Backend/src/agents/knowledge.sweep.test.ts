import assert from "node:assert/strict";
import { test } from "node:test";

import { collectObjects, planSweep, SWEEP_PAGE } from "./knowledge.sweep";

const now = Date.parse("2026-11-26T00:00:00Z");
const old = "2026-11-01T00:00:00Z";

test("an unreferenced object past the grace period is an orphan", () => {
  assert.equal(
    planSweep({ objects: [{ path: "a", updatedAt: old }], live: new Set(), now }).length,
    1,
  );
});

test("a referenced object is kept however old it is", () => {
  assert.equal(
    planSweep({
      objects: [{ path: "a", updatedAt: old }],
      live: new Set(["a"]),
      now,
    }).length,
    0,
  );
});

test("a fresh object is kept: its row may still be in flight", () => {
  assert.equal(
    planSweep({
      objects: [{ path: "a", updatedAt: new Date(now - 60_000).toISOString() }],
      live: new Set(),
      now,
    }).length,
    0,
  );
});

test("an object with no usable timestamp is never deleted", () => {
  assert.equal(
    planSweep({
      objects: [
        { path: "a", updatedAt: null },
        { path: "b", updatedAt: "not a date" },
      ],
      live: new Set(),
      now,
    }).length,
    0,
  );
});

const file = (name: string) => ({ name, updatedAt: null, folder: false });

test("a listing that caps its pages is walked to the end", async () => {
  // 2,500 objects, but the endpoint returns at most 700 per page. Advancing the
  // offset by the page size would skip 1,800 of them.
  const all = Array.from({ length: 2_500 }, (_, at) => `f${at}`);
  const offsets: number[] = [];

  const objects = await collectObjects(
    async (prefix, { limit, offset }) => {
      assert.equal(prefix, "workspaces/");
      offsets.push(offset);
      return all.slice(offset, offset + Math.min(limit, 700)).map(file);
    },
    ["workspaces/"],
  );

  assert.equal(objects.length, 2_500);
  // Five calls: four pages of data and the empty one that proves the end, since
  // a 700-entry page is not evidence of a last page.
  assert.deepEqual(offsets, [0, 700, 1400, 2100, 2500]);
});

test("a listing that ignores its offset stops after one full page", async () => {
  const page = Array.from({ length: SWEEP_PAGE }, (_, at) => file(`f${at}`));
  let calls = 0;

  const objects = await collectObjects(
    async () => {
      calls += 1;
      return page;
    },
    ["workspaces/"],
  );

  // Deduped to one path each, and the second page (all duplicates) ends it
  // rather than walking the same page a thousand times.
  assert.equal(objects.length, SWEEP_PAGE);
  assert.equal(calls, 2);
});

test("folders are walked once and their files keep the full path", async () => {
  const objects = await collectObjects(
    async (prefix) => {
      if (prefix === "workspaces/") {
        return [
          { name: "ws-a", updatedAt: null, folder: true },
          { name: "top.pdf", updatedAt: null, folder: false },
        ];
      }
      if (prefix === "workspaces/ws-a/") return [file("original.pdf")];
      return [];
    },
    ["workspaces/"],
  );

  assert.deepEqual(
    objects.map((object) => object.path),
    ["workspaces/ws-a/original.pdf", "workspaces/top.pdf"],
  );
});
