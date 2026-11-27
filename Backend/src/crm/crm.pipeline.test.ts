import assert from "node:assert/strict";
import { test } from "node:test";

import { columnOf } from "./crm.pipeline";

test("a thread nobody has read is New", () => {
  assert.equal(columnOf({ interest: "UNKNOWN", openTask: null }), "NEW");
});

test("interested with no task is Interested", () => {
  assert.equal(columnOf({ interest: "INTERESTED", openTask: null }), "INTERESTED");
});

test("interested with an open task is Follow-up", () => {
  assert.equal(columnOf({ interest: "INTERESTED", openTask: { id: "task-1" } }), "FOLLOW_UP");
});

test("a refusal leaves the active board", () => {
  assert.equal(
    columnOf({ interest: "NOT_INTERESTED", openTask: { id: "task-1" } }),
    "NOT_INTERESTED",
  );
});
