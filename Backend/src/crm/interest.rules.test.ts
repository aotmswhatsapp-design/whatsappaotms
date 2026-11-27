import assert from "node:assert/strict";
import { test } from "node:test";

import { classify, MANUAL_REASON, NO_SIGNAL, type InterestState } from "./interest.rules";

const fresh: InterestState = { stage: "UNKNOWN", score: null, body: null };

function after(
  body: string,
  stage: InterestState["stage"],
  score: number,
  reason?: string,
): InterestState {
  return reason === undefined ? { stage, score, body } : { stage, score, body, reason };
}

test("a buying question is INTERESTED and names the phrase", () => {
  const verdict = classify("How much is the rate for 10 boxes?", fresh);

  assert.equal(verdict.interest, "INTERESTED");
  assert.equal(verdict.score >= 3, true);
  assert.match(verdict.reason, /^matched ".+" \(BUYING\)$/);
});

test("a bare price question is INTERESTED without the structural bonus", () => {
  const verdict = classify("price", fresh);

  assert.equal(verdict.interest, "INTERESTED");
  assert.equal(verdict.score, 3);
  assert.equal(verdict.reason, 'matched "price" (BUYING)');
});

test("an opt-out is NOT_INTERESTED and does not auto-clear", () => {
  const stop = classify("stop messaging me", fresh);
  assert.equal(stop.interest, "NOT_INTERESTED");
  assert.equal(stop.reason, 'matched "stop messaging" (STOP)');

  const later = classify("ok fine", after("stop messaging me", "NOT_INTERESTED", stop.score));
  assert.equal(later.interest, "NOT_INTERESTED");
});

test("an opt-out clears on a buying phrase", () => {
  const verdict = classify("ok what is the price", after("stop messaging me", "NOT_INTERESTED", -4));

  assert.equal(verdict.interest, "INTERESTED");
});

test("an opt-out does not clear on contact details alone", () => {
  const verdict = classify("call me", after("stop messaging me", "NOT_INTERESTED", -4));

  assert.equal(verdict.interest, "NOT_INTERESTED");
});

test("a refusal clears on contact details and lands at UNKNOWN", () => {
  const verdict = classify("call me", after("not interested", "NOT_INTERESTED", -3));

  assert.equal(verdict.interest, "UNKNOWN");
  assert.equal(verdict.score, 2);
  assert.equal(verdict.reason, 'matched "call me" (CONTACT)');
});

test("a refusal outranks a price in the same sentence", () => {
  const verdict = classify("not interested in the price", fresh);

  assert.equal(verdict.interest, "NOT_INTERESTED");
  assert.equal(verdict.reason, 'matched "not interested" (REFUSAL)');
});

test("hesitation alone is not a no", () => {
  const verdict = classify("not now maybe later", fresh);

  assert.equal(verdict.interest, "UNKNOWN");
  assert.equal(verdict.score, -1);
});

test("a reply too short to carry a signal borrows the stored score", () => {
  const verdict = classify("ok", after("how much is the price", "INTERESTED", 4));

  assert.equal(verdict.interest, "INTERESTED");
  assert.equal(verdict.score, 4);
  assert.equal(verdict.reason, NO_SIGNAL);
});

test("a long message with no signal never moves a stage backwards", () => {
  const verdict = classify("hello there my friend how are you doing", after("price?", "INTERESTED", 4));

  assert.equal(verdict.interest, "INTERESTED");
  assert.equal(verdict.score, 4);
  assert.equal(verdict.reason, NO_SIGNAL);
});

test("structural signals decide a message that carries no phrase of its own", () => {
  const verdict = classify("do you sell 300 boxes at rs 200?", fresh);

  assert.equal(verdict.interest, "INTERESTED");
  assert.equal(verdict.score, 3);
});

test("a short message with only a number borrows the stored score", () => {
  const verdict = classify("5000 boxes", after("how much is the price", "INTERESTED", 3));

  assert.equal(verdict.interest, "INTERESTED");
  assert.equal(verdict.score, 3);
  assert.equal(verdict.reason, NO_SIGNAL);
});

test("the manual reason is a distinct stored string", () => {
  assert.equal(MANUAL_REASON, "manual");
});

test("a bare stop is still an opt-out", () => {
  const verdict = classify("stop", fresh);

  assert.equal(verdict.interest, "NOT_INTERESTED");
  assert.equal(verdict.reason, 'matched "stop" (STOP)');
});

test("a stop by a shop is a visit, not an opt-out", () => {
  const verdict = classify("can i stop by today to order a sample?", fresh);

  assert.equal(verdict.interest, "INTERESTED");
});

test("a complaint about something out of order is not a lead", () => {
  const verdict = classify("my device is out of order", fresh);

  assert.equal(verdict.interest, "UNKNOWN");
  assert.equal(verdict.reason, NO_SIGNAL);
});

test("not available now is not a buying signal", () => {
  const verdict = classify("i am not available now", fresh);

  assert.equal(verdict.interest, "UNKNOWN");
  assert.equal(verdict.reason, 'matched "not available" (SOFT_NO)');
});

test("a lone question neither lowers nor revives a stage", () => {
  const lower = classify("can you help me?", after("price", "INTERESTED", 3));
  assert.equal(lower.interest, "INTERESTED");
  assert.equal(lower.score, 3);

  const revive = classify(
    "do you sell 300 boxes at rs 200?",
    after("stop messaging me", "NOT_INTERESTED", -4),
  );
  assert.equal(revive.interest, "NOT_INTERESTED");
});

test("an opt-out survives the neutral replies that follow it", () => {
  const stop = classify("stop messaging me", fresh);
  const quiet = classify(
    "ok fine",
    after("stop messaging me", "NOT_INTERESTED", stop.score, stop.reason),
  );
  const later = classify("call me", after("ok fine", quiet.interest, quiet.score, quiet.reason));

  assert.equal(quiet.interest, "NOT_INTERESTED");
  assert.equal(later.interest, "NOT_INTERESTED");
});

test("an imperative stop is an opt-out, not a visit", () => {
  const verdict = classify("stop at once", fresh);

  assert.equal(verdict.interest, "NOT_INTERESTED");
  assert.equal(verdict.reason, 'matched "stop" (STOP)');
});

test("a visit preposition does not hide a later opt-out", () => {
  const verdict = classify("stop by; stop", fresh);

  assert.equal(verdict.interest, "NOT_INTERESTED");
});

test("an opt-out inside a longer sentence still counts", () => {
  const verdict = classify("please stop contacting me", fresh);

  assert.equal(verdict.interest, "NOT_INTERESTED");
  assert.equal(verdict.reason, 'matched "stop" (STOP)');
});

test("masking a phrase never joins the words around it", () => {
  const verdict = classify("the device is not out of order now; send me a quote", fresh);

  // "not" and "now" must not become "not now": the buying words decide.
  assert.equal(verdict.interest, "INTERESTED");
  assert.equal(verdict.reason, 'matched "quote" (BUYING)');
});

test("a fresh opt-out replaces the refusal it followed", () => {
  const no = classify("not interested", fresh);
  const stop = classify(
    "stop messaging me",
    after("not interested", "NOT_INTERESTED", no.score, no.reason),
  );
  const later = classify(
    "call me",
    after("stop messaging me", "NOT_INTERESTED", stop.score, stop.reason),
  );

  assert.equal(stop.reason, 'matched "stop messaging" (STOP)');
  assert.equal(later.interest, "NOT_INTERESTED");
});

test("a refusal survives the replies that follow it", () => {
  const no = classify("not interested", fresh);
  const quiet = classify(
    "hello there my friend",
    after("not interested", "NOT_INTERESTED", no.score, no.reason),
  );
  const later = classify(
    "is it urgent",
    after("hello there my friend", quiet.interest, quiet.score, quiet.reason),
  );

  assert.equal(quiet.interest, "NOT_INTERESTED");
  assert.equal(later.interest, "NOT_INTERESTED");
});
