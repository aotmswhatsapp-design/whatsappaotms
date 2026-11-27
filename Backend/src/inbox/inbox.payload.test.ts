import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDelivery, type ParsedMessage } from "./inbox.payload";

const delivery = (message: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba-1",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "919900000000",
              phone_number_id: "pn-1",
            },
            contacts: [{ profile: { name: "Ada" }, wa_id: "919800000000" }],
            messages: [message],
          },
        },
      ],
    },
  ],
});

const only = (message: Record<string, unknown>): ParsedMessage => {
  const [change] = parseDelivery(delivery(message));

  assert.ok(change, "the delivery produced no change");
  assert.equal(change.messages.length, 1);

  return change.messages[0];
};

const envelope = (patch: Record<string, unknown>) => ({
  from: "919800000000",
  id: "wamid.in",
  timestamp: "1700000000",
  ...patch,
});

test("a reply button arrives with the id beside the words", () => {
  const message = only(
    envelope({
      type: "interactive",
      interactive: {
        type: "button_reply",
        button_reply: { id: "b-drinks", title: "Drinks" },
      },
    }),
  );

  assert.equal(message.kind, "INTERACTIVE");
  assert.equal(message.body, "Drinks", "the thread shows the words");
  assert.deepEqual(message.payload, { tap: { id: "b-drinks", title: "Drinks" } });
});

test("a list row arrives the same way", () => {
  const message = only(
    envelope({
      type: "interactive",
      interactive: {
        type: "list_reply",
        list_reply: { id: "b-coffee", title: "Filter coffee" },
      },
    }),
  );

  assert.equal(message.kind, "INTERACTIVE");
  assert.equal(message.body, "Filter coffee");
  assert.deepEqual(message.payload, {
    tap: { id: "b-coffee", title: "Filter coffee" },
  });
});

test("a template quick reply keeps the payload the developer set", () => {
  // Meta delivers a tapped template button as `type: "button"`, with the
  // developer's payload under `button.payload` rather than `button_reply.id`.
  const message = only(
    envelope({
      type: "button",
      button: { payload: "b.confirm", text: "Yes" },
    }),
  );

  assert.equal(message.kind, "BUTTON");
  assert.equal(message.body, "Yes");
  assert.deepEqual(message.payload, { tap: { id: "b.confirm", title: "Yes" } });
});

test("an interactive message that names no id stays unparsed rather than guessed", () => {
  const message = only(
    envelope({
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { title: "Drinks" } },
    }),
  );

  assert.equal(message.body, "Drinks", "the wording is still what the customer said");
  assert.equal(message.payload, null);
});

test("a plain text message carries no tap", () => {
  const message = only(
    envelope({ type: "text", text: { body: "Do you deliver?" } }),
  );

  assert.equal(message.kind, "TEXT");
  assert.equal(message.body, "Do you deliver?");
  assert.equal(message.payload, null);
});

test("a location is still a location, not something a tap check ate", () => {
  const message = only(
    envelope({
      type: "location",
      location: { latitude: 12.97, longitude: 77.59, name: "Cafe" },
    }),
  );

  assert.equal(message.kind, "LOCATION");
  assert.deepEqual(message.payload, {
    latitude: 12.97,
    longitude: 77.59,
    name: "Cafe",
    address: null,
  });
});

test("the quoted message of a tap is kept, so the card it answered can be found", () => {
  const message = only(
    envelope({
      type: "interactive",
      context: { from: "919900000000", id: "wamid.card" },
      interactive: {
        type: "button_reply",
        button_reply: { id: "b-drinks", title: "Drinks" },
      },
    }),
  );

  assert.equal(message.contextWamid, "wamid.card");
});

/** The coexistence shape: the business is `from`, the customer is `to`. */
const echoDelivery = (message: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba-1",
      changes: [
        {
          field: "smb_message_echoes",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "919900000000",
              phone_number_id: "pn-1",
            },
            contacts: [{ wa_id: "919800000000" }],
            message_echoes: [message],
          },
        },
      ],
    },
  ],
});

test("a reply sent from the WhatsApp Business app is kept, keyed by the customer", () => {
  const [change] = parseDelivery(
    echoDelivery({
      from: "919900000000",
      to: "919800000000",
      id: "wamid.echo",
      timestamp: "1700000000",
      type: "text",
      text: { body: "On my way" },
    }),
  );

  assert.ok(change, "the echo produced no change");
  assert.equal(change.messages.length, 0, "an echo is not an inbound message");
  assert.equal(change.echoes.length, 1);

  const [echo] = change.echoes;

  // The store keys contacts and threads by the other party, which is the
  // customer here — reading `from` would file the business under its own name.
  assert.equal(echo.from, "919800000000");
  assert.equal(echo.body, "On my way");
  assert.equal(echo.kind, "TEXT");
});

test("an echo Meta sent without the customer's number is skipped, not guessed", () => {
  const [change] = parseDelivery(
    echoDelivery({
      from: "919900000000",
      to_user_id: "bsuid.123",
      id: "wamid.echo",
      timestamp: "1700000000",
      type: "text",
      text: { body: "On my way" },
    }),
  );

  assert.ok(change, "the contacts in the delivery still count");
  assert.equal(change.echoes.length, 0);
});
