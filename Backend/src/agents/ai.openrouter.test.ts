import assert from "node:assert/strict";
import { test } from "node:test";

import { OpenRouter } from "./ai.openrouter";

const KEY = "sk-or-v1-test-key-0123456789";

/** Just the one method this class reads from ConfigService. */
const client = (values: Record<string, unknown> = {}) =>
  new OpenRouter({
    get: (key: string) =>
      ({ OPEN_ROUTER_API_KEY: KEY, ...values })[key as string],
  } as never);

/** Swap `fetch` for the length of one test, and put it back however it ends. */
async function withFetch<T>(
  fake: (input: unknown, init?: RequestInit) => Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;

  globalThis.fetch = fake as typeof fetch;

  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const answer = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

const reply = { choices: [{ message: { content: "  Dosa is 80.  " } }] };

test("no key is an outcome, not an error, and nothing is called", async () => {
  let called = false;

  await withFetch(
    async () => {
      called = true;
      return answer(reply);
    },
    async () => {
      const outcome = await client({ OPEN_ROUTER_API_KEY: "" }).chat({
        messages: [{ role: "user", content: "hi" }],
      });

      assert.equal(outcome.ok, false);
      if (outcome.ok) return;

      assert.equal(outcome.reason, "not-configured");
    },
  );

  assert.equal(called, false);
});

test("the first choice's text is the answer, trimmed", async () => {
  await withFetch(
    async () => answer(reply),
    async () => {
      const outcome = await client().chat({
        messages: [{ role: "user", content: "how much is a dosa?" }],
      });

      assert.ok(outcome.ok);
      if (!outcome.ok) return;

      assert.equal(outcome.text, "Dosa is 80.");
    },
  );
});

test("the stored model travels only when it is vendor/model", async () => {
  const seen: { model?: string }[] = [];

  await withFetch(
    async (_input, init) => {
      seen.push(JSON.parse(String(init?.body)) as { model?: string });
      return answer(reply);
    },
    async () => {
      const ai = client({ OPENROUTER_MODEL: "openai/gpt-4o" });

      // The database's own default is not an OpenRouter id, so it is replaced
      // rather than sent: a 404 there would cost a reply.
      await ai.chat({ messages: [], model: "gpt-5.4-mini" });
      await ai.chat({ messages: [], model: "anthropic/claude-3.5-sonnet" });
      await ai.chat({ messages: [], model: null });
    },
  );

  assert.deepEqual(
    seen.map((row) => row.model),
    ["openai/gpt-4o", "anthropic/claude-3.5-sonnet", "openai/gpt-4o"],
  );
});

test("a call that never answers is a timeout, not a crash", async () => {
  await withFetch(
    async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    },
    async () => {
      const outcome = await client().chat({ messages: [] });

      assert.equal(outcome.ok, false);
      if (outcome.ok) return;

      assert.equal(outcome.reason, "timeout");
    },
  );
});

test("a refusal keeps the vendor's own sentence", async () => {
  await withFetch(
    async () =>
      answer({ error: { message: "Insufficient credits" } }, 402),
    async () => {
      const outcome = await client().chat({ messages: [] });

      assert.equal(outcome.ok, false);
      if (outcome.ok) return;

      // "402" and "429" are one status line apart and a different fix each.
      assert.equal(outcome.reason, "refused");
      assert.match(outcome.detail, /402/);
      assert.match(outcome.detail, /Insufficient credits/);
    },
  );
});

test("an empty choice is empty, so the caller falls back", async () => {
  await withFetch(
    async () => answer({ choices: [{ message: { content: "   " } }] }),
    async () => {
      const outcome = await client().chat({ messages: [] });

      assert.equal(outcome.ok, false);
      if (outcome.ok) return;

      assert.equal(outcome.reason, "empty");
    },
  );
});

test("attribution headers travel only when a site URL is configured", async () => {
  const headers: Record<string, string>[] = [];

  await withFetch(
    async (_input, init) => {
      headers.push(init?.headers as Record<string, string>);
      return answer(reply);
    },
    async () => {
      await client().chat({ messages: [] });
      await client({ OPENROUTER_SITE_URL: "https://aotms.test" }).chat({
        messages: [],
      });
    },
  );

  assert.equal(headers[0]?.["HTTP-Referer"], undefined);
  assert.equal(headers[0]?.["authorization"], `Bearer ${KEY}`);
  assert.equal(headers[1]?.["HTTP-Referer"], "https://aotms.test");
});