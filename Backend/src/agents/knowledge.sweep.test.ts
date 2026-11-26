import assert from "node:assert/strict";
import { test } from "node:test";

import { planSweep } from "./knowledge.sweep";

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
