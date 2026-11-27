import assert from "node:assert/strict";
import { test } from "node:test";

import type { BotFlow } from "./bot.card";
import { CARD_GONE_MESSAGE, cardTurn, type CardTurn } from "./bot.reply";
import { snapshotOf } from "./bot.snapshot";

const flow = (): BotFlow => ({
  id: "f-menu",
  rootCardId: "c-menu",
  rules: [],
  cards: [
    {
      id: "c-menu",
      title: "Breakfast",
      imageUrls: ["https://example.com/menu.jpg"],
      info: "Served 7 to 11.",
      buttons: [
        { id: "b-drinks", label: "Drinks", action: { kind: "card", cardId: "c-drinks" } },
        { id: "b-food", label: "Food", action: { kind: "text", body: "Food is served from 7." } },
        { id: "b-staff", label: "Talk to staff", action: { kind: "handoff" } },
      ],
    },
    {
      id: "c-drinks",
      title: "Drinks",
      imageUrls: [],
      info: "Filter coffee 30.",
      buttons: [
        {
          id: "b-coffee",
          label: "Filter coffee",
          action: { kind: "link", url: "https://example.com/coffee" },
        },
      ],
    },
  ],
});

/** The payload a card leaves behind, round-tripped through JSON like the column would. */
const sent = (cardId = "c-menu"): unknown =>
  JSON.parse(JSON.stringify(snapshotOf(flow(), cardId)));

const cardOf = (turn: CardTurn) => {
  if (turn.kind !== "card") {
    throw new Error(`expected the next card, got ${turn.kind}`);
  }

  return turn;
};

const asked = (patch: { body?: string | null; payload?: unknown } = {}) =>
  cardTurn({
    body: patch.body ?? null,
    payload: patch.payload ?? null,
    lastOutbound: sent(),
  });

test("a tapped button opens the card it points at", () => {
  const turn = cardOf(
    asked({
      body: "Drinks",
      payload: { tap: { id: "b-drinks", title: "Drinks" } },
    }),
  );

  assert.equal(turn.card.id, "c-drinks");
  assert.equal(turn.card.title, "Drinks");
  assert.equal(turn.flow.id, "f-menu", "the flow travels with the reply");
});

test("the card the customer picked from is the one the ids are read against", () => {
  const turn = cardTurn({
    body: "Filter coffee",
    payload: { tap: { id: "b-coffee", title: "Filter coffee" } },
    lastOutbound: sent("c-drinks"),
  });

  assert.deepEqual(turn, {
    kind: "say",
    body: "https://example.com/coffee",
  });
});

test("the numbered fallback picks by position", () => {
  const turn = cardOf(asked({ body: "1" }));

  assert.equal(turn.card.id, "c-drinks");
});

test("the words on the button work when the id is missing", () => {
  const turn = asked({ body: "Food" });

  assert.deepEqual(turn, { kind: "say", body: "Food is served from 7." });
});

test("an action that is a handoff hands the thread to a person", () => {
  assert.deepEqual(asked({ body: "3" }), { kind: "handoff" });
});

test("a question typed under a menu is still a question", () => {
  assert.deepEqual(asked({ body: "Do you deliver?" }), { kind: "none" });
});

test("a number that names no button is not a pick", () => {
  assert.deepEqual(asked({ body: "9" }), { kind: "none" });
});

test("nothing sent yet means nothing to route against", () => {
  const turn = cardTurn({
    body: "Drinks",
    payload: { tap: { id: "b-drinks", title: "Drinks" } },
    lastOutbound: null,
  });

  assert.deepEqual(turn, { kind: "none" });
});

test("the last message being a location leaves the tap unanswered by a card", () => {
  const turn = cardTurn({
    body: "Drinks",
    payload: { tap: { id: "b-drinks", title: "Drinks" } },
    lastOutbound: { latitude: 12.97, longitude: 77.59, name: "Cafe", address: null },
  });

  assert.deepEqual(turn, { kind: "none" });
});

test("a payload truncated before the flow survives is not a reason to fail", () => {
  const snapshots: unknown[] = [
    { flow: { id: "f-menu" }, cardId: "c-menu" },
    { flow: { id: "f-menu", cards: "none" }, cardId: "c-menu" },
    { cardId: "c-menu" },
    { flow: { id: "f-menu", cards: [] } },
    "menu",
    42,
  ];

  for (const lastOutbound of snapshots) {
    const turn = cardTurn({
      body: "Drinks",
      payload: null,
      lastOutbound,
    });

    assert.deepEqual(turn, { kind: "none" }, JSON.stringify(lastOutbound));
  }
});

test("a snapshot naming a card the flow no longer holds routes nothing", () => {
  const turn = cardTurn({
    body: "Drinks",
    payload: null,
    lastOutbound: sent("c-gone"),
  });

  assert.deepEqual(turn, { kind: "none" });
});

test("an action pointing at a card that is gone says so instead of going quiet", () => {
  const trimmed = flow();
  trimmed.cards = trimmed.cards.filter((card) => card.id !== "c-drinks");

  const turn = cardTurn({
    body: "Drinks",
    payload: { tap: { id: "b-drinks", title: "Drinks" } },
    lastOutbound: JSON.parse(JSON.stringify(snapshotOf(trimmed, "c-menu"))),
  });

  assert.deepEqual(turn, { kind: "say", body: CARD_GONE_MESSAGE });
});

test("a button whose action cannot be read is dropped, not guessed at", () => {
  const mangled = JSON.parse(
    JSON.stringify(snapshotOf(flow(), "c-menu")),
  ) as { flow: { cards: { buttons: unknown[] }[] } };

  mangled.flow.cards[0].buttons = [
    { id: "b-eval", label: "Run this", action: { kind: "eval", code: "rm -rf" } },
    { id: "b-drinks", label: "Drinks", action: { kind: "card", cardId: "c-drinks" } },
  ];

  const turn = cardTurn({
    body: "1",
    payload: null,
    lastOutbound: mangled,
  });

  // Position 1 is the readable button: the unknown one never occupied a slot.
  assert.equal(cardOf(turn).card.id, "c-drinks");
});
