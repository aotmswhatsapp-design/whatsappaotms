import assert from "node:assert/strict";
import { test } from "node:test";

import type { BotAction, BotButton, BotCard, BotFlow, BotRule } from "./bot.card";
import { flowProblem, MAX_CARDS } from "./bot.flow";
import { shiftCards, type ShiftInput } from "./bot.shift";

const button = (id: string, label: string, action: BotAction): BotButton => ({
  id,
  label,
  action,
});

const card = (id: string, buttons: BotButton[] = []): BotCard => ({
  id,
  name: id,
  title: id,
  imageUrls: [],
  files: [],
  info: "Dosa 80.",
  buttons,
});

const rule = (id: string, replyCardId: string): BotRule => ({
  id,
  triggers: ["hi"],
  replyCardId,
  enabled: true,
});

const flow = (agentId: string, cards: BotCard[], rootCardId: string | null = null): BotFlow => ({
  id: agentId,
  rootCardId,
  cards,
  rules: [],
});

/** A counter, so a test can say exactly which id a card was given. */
const counter = () => {
  let at = 0;

  return () => `new-${++at}`;
};

const shift = (patch: Partial<ShiftInput> & Pick<ShiftInput, "source" | "cardIds">) =>
  shiftCards({
    target: flow("agent-2", []),
    mode: "move",
    newId: counter(),
    ...patch,
  });

test("a moved card keeps everything it carried, under a new id", () => {
  const menu = {
    ...card("c-menu"),
    imageUrls: ["https://example.test/menu.jpg"],
    files: [{ url: "https://example.test/card.pdf", name: "Menu.pdf", kind: "document" as const }],
  };

  const outcome = shift({ source: flow("agent-1", [menu]), cardIds: ["c-menu"] });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  const [carried] = outcome.target.cards;

  assert.equal(carried?.id, "new-1");
  assert.deepEqual(carried?.imageUrls, ["https://example.test/menu.jpg"]);
  assert.deepEqual(carried?.files, menu.files);
  assert.equal(carried?.info, "Dosa 80.");
});

test("a button between two shifted cards follows them, by the new id", () => {
  const outcome = shift({
    source: flow("agent-1", [
      card("c-menu", [button("b-1", "Drinks", { kind: "card", cardId: "c-drinks" })]),
      card("c-drinks"),
      card("c-stay"),
    ]),
    cardIds: ["c-menu", "c-drinks"],
  });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.deepEqual(
    outcome.target.cards.map((row) => row.id),
    ["new-1", "new-2"],
  );
  assert.deepEqual(outcome.target.cards[0]?.buttons[0]?.action, {
    kind: "card",
    cardId: "new-2",
  });
  assert.equal(outcome.repairs.targetButtons, 0);
});

test("a button on a shifted card that opened a card left behind hands off instead", () => {
  const outcome = shift({
    source: flow("agent-1", [
      card("c-menu", [button("b-1", "Drinks", { kind: "card", cardId: "c-drinks" })]),
      card("c-drinks"),
    ]),
    cardIds: ["c-menu"],
  });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.deepEqual(outcome.target.cards[0]?.buttons[0]?.action, { kind: "handoff" });
  assert.equal(outcome.target.cards[0]?.buttons[0]?.label, "Drinks");
  assert.equal(outcome.repairs.targetButtons, 1);
});

test("a link or a fixed reply on a shifted card is left alone", () => {
  const outcome = shift({
    source: flow("agent-1", [
      card("c-menu", [
        button("b-1", "Site", { kind: "link", url: "https://example.test" }),
        button("b-2", "Hours", { kind: "text", body: "We open at nine." }),
      ]),
    ]),
    cardIds: ["c-menu"],
  });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.deepEqual(outcome.target.cards[0]?.buttons, [
    button("b-1", "Site", { kind: "link", url: "https://example.test" }),
    button("b-2", "Hours", { kind: "text", body: "We open at nine." }),
  ]);
});

test("a button in the source that opened the moved card hands off, and is counted", () => {
  const outcome = shift({
    source: flow("agent-1", [
      card("c-menu", [button("b-1", "Drinks", { kind: "card", cardId: "c-drinks" })]),
      card("c-drinks"),
    ]),
    cardIds: ["c-drinks"],
  });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.deepEqual(outcome.source.cards[0]?.buttons[0]?.action, { kind: "handoff" });
  assert.equal(outcome.repairs.sourceButtons, 1);
});

test("a rule that replied with the moved card is removed, and counted", () => {
  const source = {
    ...flow("agent-1", [card("c-menu"), card("c-drinks")]),
    rules: [rule("r-drinks", "c-drinks"), rule("r-menu", "c-menu")],
  };

  const outcome = shift({ source, cardIds: ["c-drinks"] });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  // Dropped rather than re-pointed: a rule has to send a card of its own flow,
  // and choosing a different one would change what a customer receives.
  assert.deepEqual(
    outcome.source.rules.map((row) => row.id),
    ["r-menu"],
  );
  assert.equal(outcome.repairs.sourceRules, 1);
  assert.equal(flowProblem(outcome.source), null);
});

test("moving the entry card leaves the source without one", () => {
  const outcome = shift({
    source: flow("agent-1", [card("c-menu"), card("c-drinks")], "c-menu"),
    cardIds: ["c-menu"],
  });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.equal(outcome.source.rootCardId, null);
  assert.equal(flowProblem(outcome.source), null);
});

test("moving any other card leaves the entry where it was", () => {
  const outcome = shift({
    source: flow("agent-1", [card("c-menu"), card("c-drinks")], "c-menu"),
    cardIds: ["c-drinks"],
  });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.equal(outcome.source.rootCardId, "c-menu");
});

test("a target with no entry of its own starts on the first card carried in", () => {
  const outcome = shift({ source: flow("agent-1", [card("c-menu")]), cardIds: ["c-menu"] });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.equal(outcome.target.rootCardId, "new-1");
});

test("a target that already has an entry keeps it", () => {
  const outcome = shift({
    source: flow("agent-1", [card("c-menu")]),
    cardIds: ["c-menu"],
    target: flow("agent-2", [card("c-welcome")], "c-welcome"),
  });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.equal(outcome.target.rootCardId, "c-welcome");
  assert.deepEqual(
    outcome.target.cards.map((row) => row.id),
    ["c-welcome", "new-1"],
  );
});

test("copy adds the card and leaves the source exactly as it was", () => {
  const source = {
    ...flow("agent-1", [
      card("c-menu", [button("b-1", "Drinks", { kind: "card", cardId: "c-drinks" })]),
      card("c-drinks"),
    ], "c-menu"),
    rules: [rule("r-menu", "c-menu")],
  };
  const before = structuredClone(source);

  const outcome = shift({ source, cardIds: ["c-menu", "c-drinks"], mode: "copy" });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.deepEqual(outcome.source, before);
  assert.deepEqual(outcome.repairs, { sourceButtons: 0, sourceRules: 0, targetButtons: 0 });
  assert.deepEqual(
    outcome.target.cards.map((row) => row.id),
    ["new-1", "new-2"],
  );
  // The copy's button follows the copy's other card, not the original's.
  assert.deepEqual(outcome.target.cards[0]?.buttons[0]?.action, {
    kind: "card",
    cardId: "new-2",
  });
});

test("a copy cannot keep the original's id", () => {
  const outcome = shift({ source: flow("agent-1", [card("c-menu")]), cardIds: ["c-menu"], mode: "copy" });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.notEqual(outcome.target.cards[0]?.id, "c-menu");
});

test("a card too many for the target is refused, naming both numbers", () => {
  const full = flow(
    "agent-2",
    Array.from({ length: MAX_CARDS }, (_, at) => card(`d-${at}`)),
  );

  const outcome = shift({
    source: flow("agent-1", [card("c-menu")]),
    cardIds: ["c-menu"],
    target: full,
  });

  assert.ok(!outcome.ok);
  if (outcome.ok) return;

  assert.match(outcome.reason, new RegExp(`${MAX_CARDS} cards`));
  assert.match(outcome.reason, /1 more would pass/);
});

test("moving every card empties the source and takes its rules with it", () => {
  const source = {
    ...flow("agent-1", [card("c-menu"), card("c-drinks")], "c-menu"),
    rules: [rule("r-menu", "c-menu")],
  };

  const outcome = shift({ source, cardIds: ["c-menu", "c-drinks"] });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.deepEqual(outcome.source.cards, []);
  assert.deepEqual(outcome.source.rules, []);
  assert.equal(outcome.source.rootCardId, null);
  assert.equal(flowProblem(outcome.source), null);
});

test("a card that is not in the source is refused rather than skipped", () => {
  const outcome = shift({ source: flow("agent-1", [card("c-menu")]), cardIds: ["c-gone"] });

  assert.ok(!outcome.ok);
  if (outcome.ok) return;

  assert.match(outcome.reason, /no longer part of this flow/);
});

test("no cards at all is refused", () => {
  const outcome = shift({ source: flow("agent-1", [card("c-menu")]), cardIds: [] });

  assert.ok(!outcome.ok);
  if (outcome.ok) return;

  assert.match(outcome.reason, /at least one card/);
});

test("the same card named twice moves once", () => {
  const outcome = shift({
    source: flow("agent-1", [card("c-menu")]),
    cardIds: ["c-menu", "c-menu"],
  });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.equal(outcome.target.cards.length, 1);
  assert.deepEqual(outcome.source.cards, []);
});

test("a fresh id that is already in use is skipped", () => {
  const ids = ["c-menu", "brand-new"];

  const outcome = shift({
    source: flow("agent-1", [card("c-menu")]),
    cardIds: ["c-menu"],
    target: flow("agent-2", [card("brand-new")]),
    newId: () => ids.shift() ?? "exhausted",
  });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.equal(outcome.target.cards[1]?.id, "exhausted");
});
