import assert from "node:assert/strict";
import { test } from "node:test";

import type { BotAction, BotCard, BotButton, BotFlow, BotRule } from "./bot.card";
import { emptyFlow, flowProblem, MAX_CARDS } from "./bot.flow";
import { MAX_CARD_IMAGES } from "./bot.limits";

const button = (id: string, label: string, action: BotAction): BotButton => ({
  id,
  label,
  action,
});

const card = (id: string, buttons: BotButton[] = []): BotCard => ({
  id,
  title: id,
  imageUrls: [],
  info: "Dosa 80.",
  buttons,
});

const flow = (
  cards: BotCard[],
  rootCardId: string | null = null,
  rules: BotRule[] = [],
): BotFlow => ({
  id: "agent-1",
  rootCardId,
  cards,
  rules,
});

const rule = (id: string, triggers: string[], replyCardId: string): BotRule => ({
  id,
  triggers,
  replyCardId,
  enabled: true,
});

test("a new agent starts with an empty flow that is still its own", () => {
  const fresh = emptyFlow("agent-7");

  assert.deepEqual(fresh, { id: "agent-7", rootCardId: null, cards: [], rules: [] });
});

test("a rule that replies with a card of the flow is accepted", () => {
  const accepted = flow([card("c-root"), card("c-welcome")], null, [
    rule("r-hi", ["hi", "hello"], "c-welcome"),
  ]);

  assert.equal(flowProblem(accepted), null);
});

test("a rule no message could ever fire is refused", () => {
  const refused = flow([card("c-root")], null, [rule("r-1", ["  ", "!!"], "c-root")]);

  assert.equal(
    flowProblem(refused),
    "A rule has no trigger, so no customer message can ever fire it.",
  );
});

test("a flow whose cards link to each other is accepted", () => {
  const accepted = flow(
    [card("c-root", [button("b-1", "Drinks", { kind: "card", cardId: "c-drinks" })]), card("c-drinks")],
    "c-root",
  );

  assert.equal(flowProblem(accepted), null);
});

test("a button pointing at a card that was deleted is refused by name", () => {
  const broken = flow([
    card("c-root", [button("b-1", "Drinks", { kind: "card", cardId: "c-gone" })]),
  ]);

  assert.match(flowProblem(broken) ?? "", /points at a card that is not in this flow/);
});

test("an entry card outside the flow is refused", () => {
  const broken = flow([card("c-root")], "c-other");

  assert.match(flowProblem(broken) ?? "", /entry card is not part of this flow/);
});

test("a button that only opens its own card is refused", () => {
  const loop = flow([card("c-root", [button("b-1", "Again", { kind: "card", cardId: "c-root" })])]);

  assert.match(flowProblem(loop) ?? "", /opens itself/);
});

test("two cards sharing an id are refused", () => {
  const broken = flow([card("c-root"), card("c-root")]);

  assert.match(flowProblem(broken) ?? "", /share the id/);
});

test("two buttons sharing an id on one card are refused", () => {
  const broken = flow([
    card("c-root", [
      button("b-1", "One", { kind: "handoff" }),
      button("b-1", "Two", { kind: "handoff" }),
    ]),
  ]);

  assert.match(flowProblem(broken) ?? "", /share the id b-1/);
});

test("one card more than the limit is refused with the limit", () => {
  const cards = Array.from({ length: MAX_CARDS + 1 }, (_, index) => card(`c-${index}`));

  assert.match(flowProblem(flow(cards)) ?? "", new RegExp(`at most ${MAX_CARDS} cards`));
});

test("a blank button label is legal: the renderer hides it rather than refusing the flow", () => {
  const accepted = flow([card("c-root", [button("b-1", "   ", { kind: "handoff" })])]);

  assert.equal(flowProblem(accepted), null);
});

test("a body longer than a WhatsApp message is refused", () => {
  const long = card("c-root");

  long.info = "x".repeat(1025);

  assert.match(flowProblem(flow([long])) ?? "", /longer than 1024 characters/);
});

test("one picture more than the limit is refused with the limit", () => {
  const loaded = card("c-root");

  loaded.imageUrls = Array.from(
    { length: MAX_CARD_IMAGES + 1 },
    (_, at) => `https://example.test/${at}.jpg`,
  );

  assert.match(
    flowProblem(flow([loaded])) ?? "",
    new RegExp(`at most ${MAX_CARD_IMAGES}`),
  );
});

test("the same picture twice on one card is refused, not silently deduplicated", () => {
  const twice = card("c-root");

  twice.imageUrls = ["https://example.test/one.jpg", "https://example.test/one.jpg"];

  assert.match(flowProblem(flow([twice])) ?? "", /same picture twice/);
});
