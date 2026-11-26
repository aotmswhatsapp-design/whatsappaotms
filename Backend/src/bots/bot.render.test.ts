import assert from "node:assert/strict";
import { test } from "node:test";

import type { BotAction, BotCard, BotButton } from "./bot.card";
import {
  LIST_OPEN_LABEL,
  NUMBERED_HINT,
  renderCard,
  type InteractiveMessage,
  type Rendered,
} from "./bot.render";
import { BODY_CHARS, TEXT_CHARS } from "./bot.limits";

const button = (
  id: string,
  label: string,
  action: BotAction = { kind: "handoff" },
): BotButton => ({ id, label, action });

const card = (patch: Partial<BotCard> = {}): BotCard => ({
  id: "c1",
  title: "Menu",
  imageUrl: null,
  info: "Dosa 80. Idli 40.",
  buttons: [],
  ...patch,
});

type Wire = Extract<Rendered, { kind: "buttons" | "list" }>;

/**
 * The structured half of the ladder, or a failure naming what was rendered
 * instead. `assert` cannot narrow a union, so the throw is what tells TypeScript
 * that this came back interactive.
 */
function wireOf(rendered: Rendered, kind: "buttons" | "list"): Wire {
  if (rendered.kind !== kind) {
    throw new Error(`expected a ${kind} message, got ${rendered.kind}`);
  }

  return rendered;
}

/** The reply buttons of a `button` message. */
function replyButtons(rendered: Rendered) {
  const action = wireOf(rendered, "buttons").interactive.action;

  assert.ok("buttons" in action, "a button message carries `action.buttons`");

  return action.buttons;
}

/** The rows of a `list` message, flattened out of its one section. */
function listRows(rendered: Rendered) {
  const action = wireOf(rendered, "list").interactive.action;

  assert.ok("sections" in action, "a list message carries `action.sections`");

  return action.sections.flatMap((section) => section.rows);
}

test("three buttons are a button message, with the ids we set", () => {
  const rendered = renderCard(
    card({
      buttons: [
        button("b-drinks", "Drinks"),
        button("b-food", "Food"),
        button("b-hours", "Hours"),
      ],
    }),
  );

  assert.equal(rendered.kind, "buttons");

  const buttons = replyButtons(rendered);

  assert.deepEqual(
    buttons.map((row) => row.reply.id),
    ["b-drinks", "b-food", "b-hours"],
    "the id is the routing key and is passed through untouched",
  );
  assert.deepEqual(
    buttons.map((row) => row.reply.title),
    ["Drinks", "Food", "Hours"],
  );
});

test("four buttons stop fitting, so the card becomes a list", () => {
  const rendered = renderCard(
    card({
      buttons: [1, 2, 3, 4].map((at) => button(`b-${at}`, `Choice ${at}`)),
    }),
  );

  const rows = listRows(rendered);

  assert.equal(rows.length, 4);
  assert.equal(rows[3].id, "b-4", "list rows carry the same id a button would");
  assert.equal(rows[3].title, "Choice 4");
});

test("ten buttons are still a list, and the opener label is Meta's limit", () => {
  const rendered = renderCard(
    card({ buttons: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((at) => button(`b-${at}`, `Pick ${at}`)) }),
  );

  assert.equal(listRows(rendered).length, 10);

  const action = wireOf(rendered, "list").interactive.action;

  assert.ok("button" in action, "a list message carries the opener label");
  assert.equal(action.button, LIST_OPEN_LABEL);
  assert.ok(LIST_OPEN_LABEL.length <= 20, "Meta refuses a longer opener label");
});

test("eleven choices cannot be structured, so they are numbered text", () => {
  const rendered = renderCard(
    card({
      buttons: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((at) =>
        button(`b-${at}`, `Pick ${at}`),
      ),
    }),
  );

  assert.equal(rendered.kind, "text");
  assert.match(rendered.body, /Dosa 80/, "the information survives the fallback");
  assert.match(rendered.body, /^1\) Pick 1$/m);
  assert.match(rendered.body, /^11\) Pick 11$/m);
  assert.ok(
    rendered.body.includes(NUMBERED_HINT),
    "the customer is told the numbers mean something",
  );
});

test("the numbers on the fallback are the button order, because routing reads them back", () => {
  const rendered = renderCard(
    card({
      buttons: ["Thali", "Filter coffee", "Curd rice", "Payasam"].map((label, at) =>
        button(`b-${at}`, label),
      ),
    }),
  );

  // Four choices fit a list, so this asserts the fallback only by forcing it.
  assert.equal(rendered.kind, "list");

  const forced = renderCard(
    card({
      buttons: Array.from({ length: 12 }, (_, at) => button(`b-${at}`, `Option ${at + 1}`)),
    }),
  );

  assert.equal(forced.kind, "text");
  assert.match(forced.body, /^1\) Option 1$/m);
  assert.match(forced.body, /^12\) Option 12$/m);
});

test("a button title longer than 20 characters is cut, not rejected", () => {
  const rendered = renderCard(
    card({ buttons: [button("b-1", "Filter coffee and snacks")] }),
  );

  const [first] = replyButtons(rendered);

  assert.ok(
    first.reply.title.length <= 20,
    `Meta refuses a longer title; got ${first.reply.title.length}`,
  );
  assert.match(first.reply.title, /^Filter coffee/);
});

test("the same cut applies to a list row title, at 24 characters", () => {
  const rendered = renderCard(
    card({
      buttons: [
        button("b-1", "Vegetarian breakfast platter"),
        button("b-2", "Drinks"),
        button("b-3", "Hours"),
        button("b-4", "Address"),
      ],
    }),
  );

  const [first] = listRows(rendered);

  assert.ok(first.title.length <= 24, `got ${first.title.length}`);
  assert.match(first.title, /^Vegetarian/);
});

test("a picture on the card becomes the interactive header", () => {
  const rendered = renderCard(
    card({
      imageUrl: "https://example.com/menu.jpg",
      buttons: [button("b-1", "Drinks")],
    }),
  );

  assert.deepEqual(wireOf(rendered, "buttons").interactive.header, {
    type: "image",
    image: { link: "https://example.com/menu.jpg" },
  });
});

test("without a picture the card's title is the header", () => {
  const rendered = renderCard(
    card({ title: "Breakfast menu", buttons: [button("b-1", "Drinks")] }),
  );

  assert.deepEqual(wireOf(rendered, "buttons").interactive.header, {
    type: "text",
    text: "Breakfast menu",
  });
});

test("a blank title means no header at all, rather than an empty one", () => {
  const rendered = renderCard(
    card({ title: "   ", buttons: [button("b-1", "Drinks")] }),
  );

  assert.equal(wireOf(rendered, "buttons").interactive.header, undefined);
});

test("a card with no information still sends a body Meta will accept", () => {
  const rendered = renderCard(
    card({ title: "Breakfast", info: "   ", buttons: [button("b-1", "Drinks")] }),
  );

  assert.equal(wireOf(rendered, "buttons").interactive.body.text, "Breakfast");
});

test("a card with no buttons is the information on its own", () => {
  const rendered = renderCard(card({ buttons: [] }));

  assert.equal(rendered.kind, "text");
  assert.equal(rendered.body, "Dosa 80. Idli 40.");
});

test("blank-labelled buttons are not offered, and do not shift the numbering", () => {
  const withBlank = card({
    buttons: [
      button("b-blank", "  "),
      button("b-drinks", "Drinks", { kind: "handoff" }),
      button("b-food", "Food", { kind: "handoff" }),
    ],
  });

  const rendered = renderCard(withBlank);

  assert.equal(rendered.kind, "buttons");

  // The visible order is what the numbered fallback and the router share, so a
  // blank row that is hidden must not occupy position 1.
  const forced = renderCard(
    card({
      buttons: [
        button("b-blank", "  "),
        button("b-drinks", "Drinks"),
        ...Array.from({ length: 11 }, (_, at) => button(`b-${at}`, `Option ${at + 1}`)),
      ],
    }),
  );

  assert.equal(forced.kind, "text");
  assert.match(forced.body, /^1\) Drinks$/m);
});

test("interactive bodies are clipped to Meta's 1024, text to 4096", () => {
  const long = "Dosa 80. ".repeat(400);

  const interactive = renderCard(
    card({ info: long, buttons: [button("b-1", "Drinks")] }),
  );

  assert.ok(
    wireOf(interactive, "buttons").interactive.body.text.length <= BODY_CHARS,
    "a longer body is refused by Meta, not truncated by it",
  );

  const text = renderCard(card({ info: long, buttons: [] }));

  assert.equal(text.kind, "text");
  assert.ok(text.body.length <= TEXT_CHARS);
  assert.ok(text.body.length > BODY_CHARS, "the text path is not cut at the interactive limit");
});

test("the interactive payload is the shape the Graph call sends", () => {
  const rendered = renderCard(
    card({ buttons: [button("b-1", "Drinks"), button("b-2", "Food")] }),
  );

  const message: InteractiveMessage = wireOf(rendered, "buttons").interactive;

  assert.equal(message.type, "button");
  assert.ok(Array.isArray((message.action as { buttons?: unknown[] }).buttons));
});
