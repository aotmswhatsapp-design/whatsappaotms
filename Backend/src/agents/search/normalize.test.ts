import assert from "node:assert/strict";
import { test } from "node:test";

import { fold, normalize, tokensOf } from "./normalize";

test("a question keeps its subjects and drops its grammar", () => {
  assert.deepEqual(normalize("What is the price of the course?").terms, [
    "pric",
    "cours",
  ]);
});

test("the OR expression is what the full-text query is built from", () => {
  assert.equal(normalize("Price list").anyOf, "pric OR list");
});

test("a repeated word is one term, so it cannot count twice", () => {
  assert.deepEqual(normalize("price price pricing").terms, ["pric"]);
});

test("a greeting has no subject to search for", () => {
  // The conversation engine answers this from its menu. Searching for the word
  // "hello" in a price list would answer it with the first chunk that says it.
  assert.deepEqual(normalize("Hello!").terms, []);
  assert.deepEqual(normalize("hi").terms, []);
});

test("punctuation and accents do not survive normalsation", () => {
  assert.equal(normalize("Café — what's the price?").text, "cafe what s the price");
});

test("a plural and its singular fold to the same word", () => {
  assert.equal(fold("services"), fold("service"));
  assert.equal(fold("prices"), fold("price"));
  assert.equal(fold("courses"), fold("course"));
  assert.equal(fold("internships"), fold("internship"));
  assert.equal(fold("deliveries"), fold("delivery"));
});

test("a participle folds onto its noun", () => {
  assert.equal(fold("pricing"), fold("price"));
  assert.equal(fold("priced"), fold("price"));
});

test("a word that only looks plural is left alone", () => {
  assert.equal(fold("business"), "business");
  assert.equal(fold("status"), "status");
  assert.equal(fold("analysis"), "analysis");
});

test("short words are never folded into each other", () => {
  // `thing` must not become `th`: a fold that reaches that far merges words
  // the corpus kept apart.
  assert.equal(fold("thing"), "thing");
  assert.equal(fold("seed"), "seed");
  assert.equal(fold("web"), "web");
});

test("tokens keep duplicates, because a caller counts positions", () => {
  assert.deepEqual(tokensOf("dosa idli dosa"), ["dosa", "idli", "dosa"]);
});
