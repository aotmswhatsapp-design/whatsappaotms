import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_LANGUAGE, detectLanguage } from "./language.detect";

test("Telugu script is Telugu, answered in Telugu", () => {
  const found = detectLanguage("మీరు ఎలా ఉన్నారు?");

  assert.equal(found.code, "te");
  assert.match(found.instruction, /Telugu script/);
});

test("Devanagari is Hindi", () => {
  const found = detectLanguage("आप कैसे हैं?");

  assert.equal(found.code, "hi");
  assert.match(found.instruction, /Hindi/);
});

test("Telugu written in English letters is Tenglish, not English", () => {
  const found = detectLanguage("Hi em chestunnavu");

  assert.equal(found.code, "te-en");
  assert.match(found.instruction, /Tenglish/);
});

test("plain English is English", () => {
  const found = detectLanguage("How much is a dosa?");

  assert.equal(found.code, "en");
  assert.match(found.instruction, /English/);
});

test("a message with no letters has no evidence, so Telugu answers", () => {
  for (const text of ["", "   ", "👍", "2"]) {
    const found = detectLanguage(text);

    assert.equal(found.code, DEFAULT_LANGUAGE);
    assert.equal(found.confidence, 0);
  }
});

test("a greeting is language-neutral, so the business default answers it", () => {
  const found = detectLanguage("Hi");

  // Counting letters would call this English and answer a Telugu customer in
  // English on their very first message.
  assert.equal(found.code, DEFAULT_LANGUAGE);
  assert.ok(found.confidence > 0 && found.confidence < 0.5);
});

test("one English word inside a Telugu sentence does not change the language", () => {
  assert.equal(detectLanguage("మెనూ price enti?").code, "te");
});

test("a romanised guess is reported with less confidence than a script reading", () => {
  assert.ok(
    detectLanguage("Hi em chestunnavu").confidence <
      detectLanguage("మీరు ఎలా ఉన్నారు?").confidence,
  );
});