import assert from "node:assert/strict";
import { test } from "node:test";

import type { ContextChunk } from "./context-chunk";
import { composeAnswer } from "./compose";

const chunk = (id: string, text: string): ContextChunk => ({
  id,
  text,
  sourceId: `s-${id}`,
  title: id,
  mime: null,
  score: 0.9,
  page: null,
  sheet: null,
  rowFrom: null,
  rowTo: null,
  heading: null,
});

const HOURS = chunk(
  "hours",
  "Opening hours\n\nWe are open Monday to Friday.\nWeekend hours are not available.",
);

test("the answer is the sentence that answers, not the chunk it came from", () => {
  const answer = composeAnswer({
    question: "when are you open",
    chunks: [HOURS],
    maxChars: 600,
  });

  assert.ok(answer);
  assert.match(answer.body, /open Monday to Friday/);
  assert.doesNotMatch(answer.body, /Weekend/);
});

test("the sentence that shares more of the question is preferred", () => {
  const answer = composeAnswer({
    question: "what is the delivery time",
    chunks: [
      chunk(
        "delivery",
        "Delivery is free.\nDelivery takes 30 minutes in town.\nWe also sell gift cards.",
      ),
    ],
    maxChars: 600,
  });

  assert.ok(answer);
  assert.match(answer.body, /Delivery takes 30 minutes/);
  assert.doesNotMatch(answer.body, /gift cards/);
});

test("a table keeps its rows on separate lines", () => {
  const answer = composeAnswer({
    question: "dosa idli",
    chunks: [chunk("menu", "Dosa 80\nIdli 40\nFilter coffee 30")],
    maxChars: 600,
  });

  assert.ok(answer);
  assert.equal(answer.body, "Dosa 80\nIdli 40");
});

test("nothing in common means no answer, not the nearest paragraph", () => {
  const answer = composeAnswer({
    question: "do you ship internationally",
    chunks: [HOURS],
    maxChars: 600,
  });

  assert.equal(answer, null);
});

test("a greeting has nothing to answer from the material", () => {
  // The conversation engine owns greetings; the composer must not answer one
  // by handing back whichever chunk happens to say "hello".
  assert.equal(
    composeAnswer({ question: "hello", chunks: [HOURS], maxChars: 600 }),
    null,
  );
});

test("no material is no answer", () => {
  assert.equal(
    composeAnswer({ question: "price", chunks: [], maxChars: 600 }),
    null,
  );
});

test("the reply budget drops the extra sentences rather than overflow", () => {
  const answer = composeAnswer({
    question: "price",
    chunks: [
      chunk(
        "plans",
        "The basic price is 100 rupees a month.\nThe standard price is 200 rupees a month.\nThe premium price is 300 rupees a month.",
      ),
    ],
    maxChars: 45,
  });

  assert.ok(answer);
  assert.ok(answer.body.length <= 45, `${answer.body.length} characters`);
  assert.match(answer.body, /^The basic price/);
});

test("a single sentence longer than the budget is cut at a word boundary", () => {
  const answer = composeAnswer({
    question: "price",
    chunks: [
      chunk(
        "long",
        "The price for the annual subscription including support and onboarding is 1200 rupees.",
      ),
    ],
    maxChars: 40,
  });

  assert.ok(answer);
  assert.ok(answer.body.length <= 40, `${answer.body.length} characters`);
  assert.match(answer.body, /^The price for the annual subscription$/);
});

test("every character of the answer was written by the business", () => {
  const answer = composeAnswer({
    question: "price of the basic plan",
    chunks: [chunk("plans", "The basic price is 100 rupees a month.\nAsk us about the rest.")],
    maxChars: 600,
  });

  assert.ok(answer);
  assert.ok(
    "The basic price is 100 rupees a month.\nAsk us about the rest.".includes(
      answer.body,
    ),
  );
});

test("only the chunks actually quoted are cited", () => {
  const other = chunk("unused", "Filter coffee 30");
  const answer = composeAnswer({
    question: "dosa idli",
    chunks: [other, chunk("menu", "Dosa 80\nIdli 40")],
    maxChars: 600,
  });

  assert.ok(answer);
  assert.deepEqual(answer.used.map((row) => row.id), ["menu"]);
});
