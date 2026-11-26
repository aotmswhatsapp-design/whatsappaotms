import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanReply, matchesEscalation } from "./reply.prompt";

const limit = (maxChars = 200) => ({ maxChars, context: "" });

test("Markdown bold becomes the bold WhatsApp reads", () => {
  assert.equal(cleanReply("**dosa** 80", limit()), "*dosa* 80");
});

test("a link the source material does not contain is removed", () => {
  const out = cleanReply("Order at https://squatter.example now.", {
    ...limit(),
    context: "Call 011 234 5678.",
  });

  assert.equal(out.includes("squatter"), false);
});

test("a link the source material contains survives, with its punctuation", () => {
  const reply = "The menu is at https://dosa.test/menu.";
  const out = cleanReply(reply, { ...limit(), context: "Menu: https://dosa.test/menu" });

  assert.equal(out, reply);
});

test("a reply over the limit is cut at a sentence, not mid-word", () => {
  assert.equal(
    cleanReply("Dosa 80. Idli 40. Coffee 30.", limit(12)),
    "Dosa 80.",
  );
});

test("a keyword fires on a whole word only", () => {
  assert.equal(matchesEscalation("I want a human", ["human"]), true);
  assert.equal(matchesEscalation("a humanitarian crisis", ["human"]), false);
});
