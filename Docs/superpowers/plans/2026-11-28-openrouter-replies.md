# OpenRouter replies: language, AI routing, RAG answers

**Goal:** an inbound WhatsApp message is answered by an OpenRouter model, in the
customer's own language, from the assigned agent's own material — and the
existing extractive composer answers when the model cannot.

**Architecture:** one HTTP client (`ai.openrouter.ts`) behind a `{ok}` union;
three pure units that can be read on their own — `language.detect.ts`,
`search/reply.compose.ts` (messages), `search/answer.ts` (model first,
extractive fallback) — and two call sites (`reply.service.ts`, the Playground)
that both go through `answerFrom`. No migration: `agents.model`,
`temperature`, `system_prompt` and `max_reply_chars` already exist.

**Tech stack:** NestJS 11, `fetch` + `AbortSignal.timeout`, `node:test` fakes.

## Global constraints

- Never commit, push or deploy. PowerShell: `;`, never `&&`.
- Tests: `node:test` + `node:assert/strict`; no live call to OpenRouter.
- The key is `OPEN_ROUTER_API_KEY` (underscore after OPEN) and is already in
  `Backend/.env`. Absent key => extractive answers, never a failure.
- The gates: `npm run typecheck`, `npm test`, `npm run build`.

## Decisions (approved)

1. **No-context handoff** is a static line per language (`te`, `te-en`, `en`,
   `hi`) picked by detection — no extra call, nothing can be invented.
2. **AI routing** runs only when the free word-overlap is unconfident: a zero
   score, or a tie at the top score with 2+ active agents. Sticky threads,
   single-agent numbers and clear local winners never cost a call. A message
   with no subject at all ("Hi") is also kept local: the model would be given
   less to route on than the overlap had.
3. **The Playground** answers through the same composer as WhatsApp.

## Tasks

1. **Config** — `config/env.ts`: `OPEN_ROUTER_API_KEY` (optional),
   `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`, `OPENROUTER_SITE_URL`,
   `OPENROUTER_SITE_NAME`, `OPENROUTER_TIMEOUT_MS` (1000–14000, so the reply
   budget cannot be configured away). `.env.example` documents them and stops
   claiming there is nothing to configure.
2. **`ai.openrouter.ts` + test** — `chat()` returns `{ok:true,text,model}` or
   `{ok:false,reason,detail}` with reason `not-configured | timeout |
   unreachable | refused | empty`. `modelFor()` accepts a stored id only when it
   is `vendor/model`; every existing row holds `gpt-5.4-mini`, which is not, so
   it resolves to `OPENROUTER_MODEL`.
3. **`language.detect.ts` + test** — Telugu/Devanagari/Latin character counts,
   Romanised-Telugu word list for Tenglish, greeting-only messages fall back to
   Telugu. Pure, zero latency.
4. **`reply.prompt.ts`** — `HANDOFF_SENTINEL`, `HANDOFF_LINES`,
   `handoffLine(language)`; `HANDOFF_MESSAGE` stays the default.
5. **`search/limits.ts` + `search/reply.compose.ts` + test** — the system
   message carries the agent's prompt, the language instruction and the
   material; the customer's text is only ever the user turn.
6. **`search/answer.ts` + test** — model first; on any failure the extractive
   `composeAnswer` runs; a `[handoff]` reply becomes `no-context`; `cleanReply`
   runs in one place so both callers sanitise identically.
7. **`agent.router.ts` + test** — `chooseSmart()` beside an unchanged
   `choose()`: local verdict, model only when unconfident, unknown id or
   failure => local verdict with `via: "fallback"`.
8. **`reply.service.ts`** — detect once after the question is read, replace the
   compose block with `answerFrom`, pass the language to each handoff. Every
   gate above it (pause, superseded, window, tap, escalation, rule) is
   untouched.
9. **`agents.service.ts` + `agents.module.ts`** — `ask()` uses `answerFrom`;
   `OpenRouter` is a provider so the router and both services receive it.
10. **Gates** — typecheck, full suite, build; report counts.

## Live check (2026-11-28)

The key authenticates, but the account has never purchased credits: `openai/gpt-4o`
and `openrouter/auto` both answer **402 Insufficient credits**, so neither can be
the default yet. `OPENROUTER_MODEL` therefore defaults to `openrouter/free`
(zero balance, routes across the free models). Verified end-to-end against the
compiled path with the real key: Telugu question, `via: "model"`, reply
`మసాలా దోస — ₹80.`, about two seconds, cost 0. Switch to `openai/gpt-4o` once
credits are added — one variable, no code change.

A refusal used to be invisible: the reply path falls back to the extractive
answer and the customer is still served. `ai.openrouter.ts` now logs one warning
per refusal or empty model answer, naming the model and the vendor's sentence.

## Known limit to disclose

`AgentsRunner` answers **one run per tick (1 s)**. A 10 s model call therefore
serves about six customers a minute; the 15 s budget holds per customer up to
that rate and queues beyond it. Bounded concurrency is a separate change: it
alters five existing runner assertions, so it is not bundled here.