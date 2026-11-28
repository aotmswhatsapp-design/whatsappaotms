import assert from "node:assert/strict";
import { test } from "node:test";

import type { BotCard, BotFlow, BotRule } from "./bot.card";
import { matchesTrigger, ruleReply, wordsOf } from "./bot.rules";

const card = (id: string): BotCard => ({
  id,
  name: id,
  title: id,
  imageUrls: [],
  files: [],
  info: id,
  buttons: [],
});

const rule = (
  id: string,
  triggers: string[],
  replyCardId: string,
  enabled = true,
): BotRule => ({ id, triggers, replyCardId, enabled });

const flow = (cards: BotCard[], rules: BotRule[]): BotFlow => ({
  id: "agent-1",
  rootCardId: null,
  cards,
  rules,
});

test("words are lowercased and stripped of punctuation", () => {
  assert.equal(wordsOf("  Hi!!!  "), "hi");
  assert.equal(wordsOf("Good   morning, friend?"), "good morning friend");
});

test("a greeting matches however it is typed", () => {
  for (const message of ["hi", "HI", "Hi!", "hello there", "hey"]) {
    assert.equal(matchesTrigger(message, ["hi", "hello", "hey"]), true, message);
  }
});

test("a short trigger does not fire inside a longer word", () => {
  assert.equal(matchesTrigger("this is my order", ["hi"]), false);
  assert.equal(matchesTrigger("ship it", ["hi"]), false);
  assert.equal(matchesTrigger("hello", ["hell"]), false);
});

test("a phrase trigger matches the phrase, not one of its words", () => {
  assert.equal(matchesTrigger("good morning!", ["good morning"]), true);
  assert.equal(matchesTrigger("good evening", ["good morning"]), false);
});

test("a message with no letters or digits matches nothing", () => {
  assert.equal(matchesTrigger("🙂", ["hi"]), false);
  assert.equal(matchesTrigger("", ["hi"]), false);
});

test("a blank trigger is not a trigger", () => {
  assert.equal(matchesTrigger("hi", ["  ", "!!"]), false);
});

test("the first matching rule answers", () => {
  const answered = ruleReply(
    flow(
      [card("c-complaint"), card("c-welcome")],
      [
        rule("r-complaint", ["complaint", "refund"], "c-complaint"),
        rule("r-hi", ["hi", "hello"], "c-welcome"),
      ],
    ),
    "hi, I want a refund",
  );

  assert.equal(answered?.rule.id, "r-complaint");
  assert.equal(answered?.card.id, "c-complaint");
});

test("a disabled rule is skipped, not deleted", () => {
  const answered = ruleReply(
    flow(
      [card("c-welcome")],
      [rule("r-hi", ["hi"], "c-welcome", false)],
    ),
    "hi",
  );

  assert.equal(answered, null);
});

test("a rule whose card was deleted answers nothing", () => {
  const answered = ruleReply(
    flow([card("c-welcome")], [rule("r-hi", ["hi"], "c-gone")]),
    "hi",
  );

  assert.equal(answered, null);
});

test("a flow with no rules answers nothing", () => {
  assert.equal(ruleReply(flow([card("c-welcome")], []), "hi"), null);
});
