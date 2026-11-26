import assert from "node:assert/strict";
import { test } from "node:test";

import { readTap } from "./bot.tap";

test("a reply button carries the id the business set on it", () => {
  const tap = readTap({
    body: "Drinks",
    payload: { tap: { id: "b-drinks", title: "Drinks" } },
  });

  assert.deepEqual(tap, { id: "b-drinks", number: null, label: "Drinks" });
});

test("a delivered title wins over the words typed beside it", () => {
  const tap = readTap({
    body: "Drinks",
    payload: { tap: { id: "b-drinks", title: "Beverages" } },
  });

  assert.equal(tap.label, "Beverages");
});

test("a number typed into the fallback is read as a position", () => {
  const tap = readTap({ body: "2", payload: null });

  assert.deepEqual(tap, { id: null, number: 2, label: "2" });
});

test("the ways a customer writes a bare number all count", () => {
  for (const body of ["2", " 2 ", "#2", "2)", "2.", "2:", "2-"]) {
    assert.equal(readTap({ body, payload: null }).number, 2, body);
  }
});

test("a sentence that begins with a number is not a pick", () => {
  assert.equal(readTap({ body: "2 people", payload: null }).number, null);
  assert.equal(readTap({ body: "I want 2 dosas", payload: null }).number, null);
});

test("zero and out-of-range digits are not positions", () => {
  assert.equal(readTap({ body: "0", payload: null }).number, null);
});

test("a message with no words yields no evidence at all", () => {
  assert.deepEqual(readTap({ body: null, payload: null }), {
    id: null,
    number: null,
    label: null,
  });

  assert.deepEqual(readTap({ body: "   ", payload: undefined }), {
    id: null,
    number: null,
    label: null,
  });
});

test("a payload of another kind is ignored rather than trusted", () => {
  const payloads: unknown[] = [
    "tap",
    42,
    null,
    { contacts: [{ name: "Ada" }] },
    { tap: null },
    { tap: "b-drinks" },
    { tap: { title: "Drinks" } },
    { tap: { id: "", title: "Drinks" } },
  ];

  for (const payload of payloads) {
    const tap = readTap({ body: "Drinks", payload });

    assert.equal(tap.id, null, JSON.stringify(payload));
    assert.equal(tap.label, "Drinks", "the words are still there to fall back on");
  }
});

test("a tap with an id but no words still routes on its id", () => {
  const tap = readTap({ body: null, payload: { tap: { id: "b-drinks" } } });

  assert.equal(tap.id, "b-drinks");
  assert.equal(tap.label, "b-drinks");
});
