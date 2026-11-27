import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { ConfigService } from "@nestjs/config";

import { MetaGraph } from "./meta-graph";

/**
 * The sync request is a single POST whose path and body Meta documents
 * exactly, and which may be performed only once. A wrong path is a silent
 * no-op against the wrong object, so both are read here rather than trusted.
 */

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function graph() {
  const config = {
    get: (key: string) =>
      key === "META_GRAPH_BASE_URL" ? "https://graph.test" : undefined,
  } as unknown as ConfigService;

  return new MetaGraph(config);
}

function answer(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];

  globalThis.fetch = (async (url: string | URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return calls;
}

test("the sync request is one POST with the documented body", async () => {
  const calls = answer({ messaging_product: "whatsapp", request_id: "req-1" });

  const result = await graph().requestSmbAppData({
    version: "v23.0",
    phoneNumberId: "109800000000000",
    token: "tok-1",
    syncType: "history",
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://graph.test/v23.0/109800000000000/smb_app_data",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    (calls[0].init.headers as Record<string, string>).authorization,
    "Bearer tok-1",
  );
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    messaging_product: "whatsapp",
    sync_type: "history",
  });
  assert.deepEqual(result, { requestId: "req-1" });
});

test("a reply without a request id is still an accepted request", async () => {
  answer({ messaging_product: "whatsapp" });

  const result = await graph().requestSmbAppData({
    version: "v23.0",
    phoneNumberId: "109800000000000",
    token: "tok-1",
    syncType: "smb_app_state_sync",
  });

  // Refusing to record it would send the caller back to Meta, which allows
  // each kind once — the second attempt is the one that fails.
  assert.deepEqual(result, { requestId: null });
});