import assert from "node:assert/strict";
import { test } from "node:test";

import { detectLanguage } from "../language.detect";
import { answerFrom, type AnswerAgent, type Chatter } from "./answer";
import type { ContextChunk } from "./context-chunk";

const chunk = (text: string): ContextChunk => ({
  id: "c1",
  text,
  sourceId: "source-1",
  title: "Menu.pdf",
  mime: "application/pdf",
  score: 0.9,
  page: 1,
  sheet: null,
  rowFrom: null,
  rowTo: null,
  heading: null,
});

const agent: AnswerAgent = {
  name: "Sri Lakshmi Tiffins",
  systemPrompt: "Be brief.",
  model: "openai/gpt-4o",
  maxReplyChars: 900,
};

/** A provider that answers what it is told to, and remembers what it was asked. */
function chatterOf(reply: Awaited<ReturnType<Chatter["chat"]>>) {
  const seen: Parameters<Chatter["chat"]>[0][] = [];

  const chatter: Chatter = {
    chat: async (request) => {
      seen.push(request);
      return reply;
    },
  };

  return { chatter, seen };
}

const ask = (over: {
  chatter?: Chatter | null;
  chunks?: ContextChunk[];
  question?: string;
} = {}) =>
  answerFrom({
    agent,
    question: over.question ?? "how much is a dosa?",
    chunks: over.chunks ?? [chunk("Masala dosa — 80. Plain dosa — 60.")],
    language: detectLanguage(over.question ?? "how much is a dosa?"),
    chatter: over.chatter,
  });

test("the model's sentence is the reply when it writes one", async () => {
  const { chatter } = chatterOf({ ok: true, text: "  Masala dosa is ₹80.  " });

  const outcome = await ask({ chatter });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.equal(outcome.body, "Masala dosa is ₹80.");
  assert.equal(outcome.via, "model");
});

test("the model is asked for the agent's model, in the customer's language", async () => {
  const { chatter, seen } = chatterOf({ ok: true, text: "ధర ₹80." });

  await ask({ chatter, question: "మాసాల దోస ధర ఎంత?" });

  const request = seen[0];

  assert.equal(request?.model, "openai/gpt-4o");
  // The customer's words are the user turn; the rules never merge with them.
  assert.equal(request?.messages[1]?.role, "user");
  assert.equal(request?.messages[1]?.content, "మాసాల దోస ధర ఎంత?");
  assert.match(request?.messages[0]?.content ?? "", /Telugu script/);
});

test("a model that says [handoff] is taken at its word, and the quote answers", async () => {
  const { chatter } = chatterOf({ ok: true, text: "[handoff]" });

  const outcome = await ask({ chatter });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.equal(outcome.via, "extractive");
  assert.match(outcome.body, /Masala dosa/);
});

test("a provider that fails is not a customer left waiting", async () => {
  const { chatter } = chatterOf({ ok: false, reason: "timeout" });

  const outcome = await ask({ chatter });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.equal(outcome.via, "extractive");
});

test("an invented web address never reaches the customer", async () => {
  const { chatter } = chatterOf({
    ok: true,
    text: "Order at https://evil.example.com today.",
  });

  const outcome = await ask({ chatter });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  // The material names no link, so the only link in the reply was invented.
  assert.equal(outcome.body.includes("evil"), false);
});

test("a greeting with nothing retrieved is answered, not handed off", async () => {
  const { chatter, seen } = chatterOf({
    ok: true,
    text: "Hello! How can I help you today?",
  });

  const outcome = await ask({ chatter, chunks: [], question: "hi" });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.equal(outcome.body, "Hello! How can I help you today?");
  assert.equal(outcome.via, "model");
  // No material had a part in it, so none may be reported as used.
  assert.deepEqual(outcome.used, []);
  assert.equal(seen.length, 1);
});

test("with nothing retrieved the model is given rules, and no material", async () => {
  const { chatter, seen } = chatterOf({ ok: true, text: "Hello!" });

  await ask({ chatter, chunks: [], question: "do you know Hindi" });

  const system = seen[0]?.messages[0]?.content ?? "";

  // The point of this branch: with nothing to quote, a business fact is still
  // the handoff's — so no empty MATERIAL section is offered as though it were
  // context the model might elaborate on.
  assert.equal(system.includes("MATERIAL"), false);
  assert.match(system, /\[handoff\]/);
  assert.match(system, /Never state or guess a price/);
  // The customer's words stay the user turn.
  assert.equal(seen[0]?.messages[1]?.content, "do you know Hindi");
});

test("with nothing retrieved, a model that declines still hands off", async () => {
  const { chatter } = chatterOf({ ok: true, text: "[handoff]" });

  const outcome = await ask({
    chatter,
    chunks: [],
    question: "do you deliver to Kurnool?",
  });

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;

  assert.equal(outcome.reason, "no-context");
});

test("with nothing retrieved, a provider that fails still hands off", async () => {
  const { chatter } = chatterOf({ ok: false, reason: "timeout" });

  const outcome = await ask({ chatter, chunks: [], question: "hi" });

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;

  assert.equal(outcome.reason, "no-context");
});

test("with nothing retrieved and no key, the handoff is the answer", async () => {
  const outcome = await ask({ chatter: null, chunks: [], question: "hi" });

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;

  assert.equal(outcome.reason, "no-context");
});

test("a link invented without material never reaches the customer", async () => {
  const { chatter } = chatterOf({
    ok: true,
    text: "Sure, reach us at https://evil.example.com.",
  });

  const outcome = await ask({
    chatter,
    chunks: [],
    question: "where can I read more?",
  });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  // With no material there is no link to allow, so any link was invented.
  assert.equal(outcome.body.includes("evil"), false);
});

test("when both engines come up empty, the caller is told to hand off", async () => {
  const { chatter } = chatterOf({ ok: true, text: "[handoff]" });

  const outcome = await ask({
    chatter,
    question: "do you have a franchise in Kurnool?",
    chunks: [chunk("Masala dosa — 80. Plain dosa — 60.")],
  });

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;

  assert.equal(outcome.reason, "no-context");
});

test("with no key configured the quote answers, and nothing is awaited", async () => {
  const outcome = await ask({ chatter: null });

  assert.ok(outcome.ok);
  if (!outcome.ok) return;

  assert.equal(outcome.via, "extractive");
  assert.match(outcome.body, /Masala dosa/);
});