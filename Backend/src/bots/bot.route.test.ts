import assert from "node:assert/strict";
import { test } from "node:test";

import type { BotAction, BotCard, BotButton } from "./bot.card";
import { routeTap, targetOf, buttonWith } from "./bot.route";
import type { TapEvidence } from "./bot.tap";

const handoff: BotAction = { kind: "handoff" };
const toDrinks: BotAction = { kind: "card", cardId: "c-drinks" };
const toFood: BotAction = { kind: "card", cardId: "c-food" };
const toWeb: BotAction = { kind: "link", url: "https://example.com" };

const button = (id: string, label: string, action: BotAction): BotButton => ({
  id,
  label,
  action,
});

const card = (buttons: BotButton[]): BotCard => ({
  id: "c-root",
  name: "Menu",
  title: "Menu",
  imageUrls: [],
  files: [],
  info: "Dosa 80. Idli 40.",
  buttons,
});

const tap = (patch: Partial<TapEvidence> = {}): TapEvidence => ({
  id: null,
  number: null,
  label: null,
  ...patch,
});

const MENU = card([
  button("b-drinks", "Drinks", toDrinks),
  button("b-food", "Food", toFood),
  button("b-web", "Website", toWeb),
]);

test("an id still lands after the button was renamed", () => {
  const renamed = card([button("b-drinks", "Beverages", toDrinks)]);
  const action = routeTap(renamed, tap({ id: "b-drinks", label: "Drinks" }));

  assert.deepEqual(action, toDrinks);
});

test("a tap on a deleted button falls through to its position", () => {
  const action = routeTap(MENU, tap({ id: "b-gone", number: 2, label: "Gone" }));

  assert.deepEqual(action, toFood);
});

test("the words are the last resort, and are matched without case", () => {
  assert.deepEqual(routeTap(MENU, tap({ label: "  DRINKS " })), toDrinks);
});

test("nothing matching means nothing happens", () => {
  assert.equal(routeTap(MENU, tap({ id: "b-gone", label: "Hours" })), null);
  assert.equal(routeTap(MENU, tap()), null);
});

test("a number past the last button matches nothing", () => {
  assert.equal(routeTap(MENU, tap({ number: 4 })), null);
});

test("a blank-labelled button does not occupy a position", () => {
  const withBlank = card([
    button("b-blank", "   ", handoff),
    button("b-drinks", "Drinks", toDrinks),
  ]);

  // The numbered fallback counts only the buttons it prints, so position 1 has
  // to be the first visible one.
  assert.deepEqual(routeTap(withBlank, tap({ number: 1 })), toDrinks);
});

test("an id on a button that was never shown is not a button", () => {
  const withBlank = card([
    button("b-blank", "   ", handoff),
    button("b-drinks", "Drinks", toDrinks),
  ]);

  // The tap lookup asks this of every card it reads back, so an id can never
  // resolve to a button the customer was not offered.
  assert.equal(buttonWith(withBlank, "b-blank"), null);
  assert.deepEqual(buttonWith(withBlank, "b-drinks")?.action, toDrinks);
});

test("two buttons with the same label route to the first", () => {
  const twins = card([
    button("b-first", "Drinks", toDrinks),
    button("b-second", "Drinks", toFood),
  ]);

  assert.deepEqual(routeTap(twins, tap({ label: "Drinks" })), toDrinks);
});

test("an id action resolves to the card it names", () => {
  const cards = [MENU, { ...MENU, id: "c-drinks", title: "Drinks" }];

  assert.equal(targetOf(cards, toDrinks)?.id, "c-drinks");
});

test("actions that are not a card resolve to nothing", () => {
  assert.equal(targetOf([MENU], toWeb), null);
  assert.equal(targetOf([MENU], handoff), null);
});

test("a card the flow no longer holds resolves to nothing", () => {
  assert.equal(targetOf([MENU], { kind: "card", cardId: "c-gone" }), null);
});
