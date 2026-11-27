import assert from "node:assert/strict";
import { test } from "node:test";

import { orderFor, type RosterRow } from "./round.robin";

const rows: RosterRow[] = [
  { userId: "b", role: "AGENT", designation: "Sales", lastAssignedAt: new Date("2026-11-27T10:00:00Z") },
  { userId: "a", role: "AGENT", designation: "Sales", lastAssignedAt: null },
  { userId: "c", role: "AGENT", designation: "Sales", lastAssignedAt: new Date("2026-11-26T10:00:00Z") },
  { userId: "owner", role: "OWNER", designation: "Sales", lastAssignedAt: null },
  { userId: "d", role: "AGENT", designation: "Support", lastAssignedAt: null },
];

test("never picked before wins, then the oldest pick, then the id", () => {
  assert.deepEqual(
    orderFor(rows, "Sales").map((row) => row.userId),
    ["a", "c", "b"],
  );
});

test("the owner is never in the rotation", () => {
  assert.equal(
    orderFor(rows, "Sales").some((row) => row.userId === "owner"),
    false,
  );
});

test("another designation is not in this rotation", () => {
  assert.deepEqual(orderFor(rows, "Support").map((row) => row.userId), ["d"]);
});

test("a designation nobody carries picks nobody", () => {
  assert.deepEqual(orderFor(rows, "Finance"), []);
});
