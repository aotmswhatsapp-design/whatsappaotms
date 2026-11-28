import assert from "node:assert/strict";
import { test } from "node:test";

import { pickDocument, wantsDocument, type FileCandidate } from "./document.match";

const at = (day: number) =>
  new Date(`2026-11-${String(day).padStart(2, "0")}T00:00:00Z`);

const file = (id: string, title: string, day = 1): FileCandidate => ({
  id,
  title,
  updatedAt: at(day),
});

const brochure = file("brochure", "BUILD MARQUE Brochure 2026.pdf", 10);
const pricing = file("pricing", "Pricing 2026.pdf", 12);
const profile = file("profile", "Company Profile.pdf", 8);

test("a request for a named file is recognised in English", () => {
  assert.equal(wantsDocument("Send me the AOTMS brochure PDF"), true);
  assert.equal(wantsDocument("Can you share the pricing docx?"), true);
  assert.equal(wantsDocument("I need the company profile"), true);
});

test("a question about a brochure is not a request for it", () => {
  // The distinction the whole feature rests on: this must be answered from the
  // text, not answered by pushing a 4 MB file at the customer.
  assert.equal(wantsDocument("What does the brochure say about delivery?"), false);
  assert.equal(wantsDocument("Is the brochure available in Telugu?"), false);
  assert.equal(wantsDocument("Do you deliver to Kurnool?"), false);
});

test("the ask is recognised in Telugu, Tenglish and Hindi", () => {
  assert.equal(wantsDocument("బ్రోషర్ పంపండి"), true);
  assert.equal(wantsDocument("brochure pampandi"), true);
  assert.equal(wantsDocument("naku brochure kavali"), true);
  assert.equal(wantsDocument("ब्रोशर भेजो"), true);
  assert.equal(wantsDocument("brochure chahiye"), true);
});

test("the filename is matched whatever its case and punctuation", () => {
  const chosen = pickDocument("send me the DURA+ sheet", [
    file("dura", "DURA+ Sheet.pdf"),
    brochure,
  ]);

  assert.equal(chosen?.id, "dura");
});

test("the file that shares more of the request wins", () => {
  assert.equal(pickDocument("I need the company profile", [brochure, pricing, profile])?.id, "profile");
  assert.equal(pickDocument("send me the pricing pdf", [brochure, pricing, profile])?.id, "pricing");
});

test("a tie goes to the file that was replaced most recently", () => {
  const older = file("old", "Brochure 2025.pdf", 1);
  const newer = file("new", "Brochure 2026.pdf", 20);

  // Passed oldest-first on purpose: the order of the array must not decide.
  assert.equal(pickDocument("send me the brochure", [older, newer])?.id, "new");
  assert.equal(pickDocument("send me the brochure", [newer, older])?.id, "new");
});

test("naming only a format names nothing", () => {
  // "the PDF" fits every PDF equally, so picking the newest one would be a
  // guess dressed up as a match.
  assert.equal(pickDocument("send me the pdf", [brochure, pricing]), null);
  assert.equal(wantsDocument("send me the pdf"), true);
});

test("a file the agent does not have falls through to an answer", () => {
  assert.equal(pickDocument("send me the warranty policy", [brochure, pricing, profile]), null);
});

test("a request with no noun at all picks nothing", () => {
  assert.equal(pickDocument("send me a file", [brochure]), null);
  assert.equal(pickDocument("", [brochure]), null);
});

test("an agent with no files has nothing to send", () => {
  assert.equal(pickDocument("send me the brochure", []), null);
});