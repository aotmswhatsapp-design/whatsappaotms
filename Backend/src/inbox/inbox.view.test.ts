import assert from "node:assert/strict";
import { test } from "node:test";

import { messageView, type MessageSource } from "./inbox.view";

/**
 * A card as it was sent: the picture, the header, the information and one
 * button. The snapshot in `payload` is the whole flow, which is what the tap
 * router reads; the thread only needs the card that went out.
 */
const card = {
  id: "card-menu",
  title: "Menu",
  imageUrl: "https://storage.test/bots/ws-a/agent-1/one.jpg",
  info: "Dosa 80.",
  buttons: [{ id: "btn-drinks", label: "Drinks", action: { kind: "handoff" } }],
};

function row(patch: Partial<MessageSource>): MessageSource {
  return {
    id: "m-1",
    wamid: "wamid.1",
    direction: "OUTBOUND",
    kind: "INTERACTIVE",
    agentId: null,
    status: "SENT",
    body: "Dosa 80.",
    templateName: null,
    templateLanguage: null,
    tapTarget: null,
    mediaId: null,
    mediaMime: null,
    mediaName: null,
    mediaSize: null,
    mediaPath: null,
    errorReason: null,
    contextWamid: null,
    payload: null,
    sentAt: new Date("2026-11-27T10:00:00Z"),
    deliveredAt: null,
    readAt: null,
    createdAt: new Date("2026-11-27T10:00:00Z"),
    ...patch,
  };
}

test("a sent card comes back with its picture and its buttons", () => {
  const view = messageView(
    row({
      payload: {
        flow: { id: "agent-1", rootCardId: card.id, cards: [card], rules: [] },
        cardId: card.id,
      },
    }),
  );

  assert.equal(view.direction, "OUTBOUND");
  assert.equal(view.card?.imageUrl, card.imageUrl);
  assert.equal(view.card?.buttons[0]?.label, "Drinks");
  assert.equal(
    view.payload,
    null,
    "a card is drawn from `card`; `payload` stays the location/contacts reader",
  );
});

test("a snapshot naming a card the flow does not hold is no card", () => {
  const view = messageView(
    row({
      payload: {
        flow: { id: "agent-1", rootCardId: null, cards: [], rules: [] },
        cardId: "card-gone",
      },
    }),
  );

  assert.equal(view.card, null);
});

test("a location is a payload, never a card", () => {
  const view = messageView(
    row({
      kind: "LOCATION",
      body: "Cafe",
      payload: { latitude: 12.97, longitude: 77.59, name: "Cafe", address: null },
    }),
  );

  assert.equal(view.card, null);
  assert.equal(view.payload?.kind, "location");
});

test("a card sent as plain text still carries the card for the thread", () => {
  const view = messageView(
    row({
      kind: "TEXT",
      body: "Dosa 80.\n\n1) Drinks\n\nReply with a number.",
      payload: {
        flow: { id: "agent-1", rootCardId: card.id, cards: [card], rules: [] },
        cardId: card.id,
      },
    }),
  );

  assert.equal(view.card?.id, card.id);
});
