import assert from "node:assert/strict";
import { test } from "node:test";

import { AgentRouter, type SmartRouting } from "./agent.router";

/** One candidate, in the shape `findMany` selects. */
const agent = (id: string, name: string, description: string | null = null) => ({
  id,
  name,
  description,
});

/** The rows arrive oldest first, which is the order the router reads them in. */
const routerOf = (agents: ReturnType<typeof agent>[]) =>
  new AgentRouter({ agent: { findMany: async () => agents } } as never);

const ask = (
  router: AgentRouter,
  question: string,
  agentId: string | null = null,
) => router.choose({ whatsappAccountId: "acct-1", agentId, question });

test("nobody on duty means no agent, so the thread stays for a person", async () => {
  assert.deepEqual(await ask(routerOf([]), "how much is delivery?"), {
    agentId: null,
    sticky: false,
  });
});

test("a thread keeps the owner that still works here", async () => {
  const router = routerOf([
    agent("billing", "Billing"),
    agent("parcels", "Parcel tracking"),
  ]);

  // The question is squarely the other agent's subject; the owner still wins,
  // because a conversation must not change voice halfway through.
  assert.deepEqual(await ask(router, "where is my parcel", "billing"), {
    agentId: "billing",
    sticky: true,
  });
});

test("one active agent answers without being compared", async () => {
  const router = routerOf([agent("billing", "Billing")]);

  assert.deepEqual(await ask(router, "parcel tracking", "switched-off"), {
    agentId: "billing",
    sticky: false,
  });
});

test("the agent whose name carries the subject answers", async () => {
  const router = routerOf([
    agent("menu", "Menu and prices"),
    agent("parcels", "Parcel tracking"),
  ]);

  assert.equal((await ask(router, "how much is the dosa on your menu?")).agentId, "menu");
  assert.equal((await ask(router, "where is my parcel?")).agentId, "parcels");
});

test("a name match outranks the same word found in a description", async () => {
  const router = routerOf([
    agent("hint", "Support", "delivery and prices"),
    agent("named", "Delivery"),
  ]);

  // "delivery" is in both; only one of them put it in the title.
  assert.equal((await ask(router, "when is delivery?")).agentId, "named");
});

test("the agent sharing the most words wins, not the first that shares one", async () => {
  const router = routerOf([
    agent("menu", "Menu", "dosa idli prices"),
    agent("parcels", "Delivery", "timing area"),
  ]);

  assert.equal((await ask(router, "dosa prices please")).agentId, "menu");
});

test("a tie goes to the oldest agent, which makes the choice stable", async () => {
  const router = routerOf([
    agent("older", "Billing", "prices"),
    agent("newer", "Menu", "prices"),
  ]);

  assert.equal((await ask(router, "what are the prices?")).agentId, "older");
});

test("a question with no subject falls back to the oldest agent", async () => {
  const router = routerOf([
    agent("older", "Billing"),
    agent("newer", "Menu", "dosa prices"),
  ]);

  assert.equal((await ask(router, "hello there, thanks!")).agentId, "older");
});

/**
 * A provider that answers what it is told to. `configured` is spread in so a
 * test can build the unkeyed client the same way.
 */
function aiOf(
  reply: { ok: true; text: string } | { ok: false; reason: string },
  configured = true,
) {
  const seen: { messages: { role: string; content: string }[] }[] = [];

  return {
    seen,
    ai: {
      configured,
      chat: async (request: { messages: { role: string; content: string }[] }) => {
        seen.push(request);
        return reply;
      },
    } as never,
  };
}

const smarts = (
  agents: ReturnType<typeof agent>[],
  ai?: ReturnType<typeof aiOf>["ai"],
) => new AgentRouter({ agent: { findMany: async () => agents } } as never, ai);

const smart = (
  router: AgentRouter,
  question: string,
  agentId: string | null = null,
): Promise<SmartRouting> =>
  router.chooseSmart({ whatsappAccountId: "acct-1", agentId, question });

test("a question the words already settle never costs a model call", async () => {
  const { ai, seen } = aiOf({ ok: true, text: "billing" });
  const router = smarts(
    [agent("billing", "Billing"), agent("menu", "Menu and prices")],
    ai,
  );

  const routing = await smart(router, "what are your prices?");

  assert.equal(routing.agentId, "menu");
  assert.equal(routing.via, "local");
  assert.equal(seen.length, 0);
});

test("a thread that already has an owner is never re-routed by a model", async () => {
  const { ai, seen } = aiOf({ ok: true, text: "menu" });
  const router = smarts(
    [agent("billing", "Billing"), agent("menu", "Menu and prices")],
    ai,
  );

  const routing = await smart(router, "where is my parcel", "billing");

  assert.equal(routing.agentId, "billing");
  assert.equal(routing.sticky, true);
  assert.equal(routing.via, "local");
  assert.equal(seen.length, 0);
});

test("when the words claim nobody, the model reads the question", async () => {
  const { ai, seen } = aiOf({ ok: true, text: "parcels" });
  const router = smarts(
    [agent("menu", "Menu and prices"), agent("parcels", "Parcel tracking")],
    ai,
  );

  // Not one word of this appears in either agent; the old router would have
  // handed it to the oldest.
  const routing = await smart(router, "nenu Banglore ki pampinchali");

  assert.equal(routing.agentId, "parcels");
  assert.equal(routing.via, "model");

  // The model is shown the candidates it may choose from, never an id it
  // could not have seen.
  assert.match(seen[0]?.messages[1]?.content ?? "", /Parcel tracking/);
  assert.match(seen[0]?.messages[1]?.content ?? "", /Banglore/);
});

test("an id that is not on the shortlist is refused, and the oldest answers", async () => {
  const { ai } = aiOf({ ok: true, text: "some-other-workspace-agent" });
  const router = smarts(
    [agent("older", "Billing"), agent("newer", "Parcel tracking")],
    ai,
  );

  const routing = await smart(router, "nenu Banglore ki pampinchali");

  assert.equal(routing.agentId, "older");
  assert.equal(routing.via, "fallback");
});

test("a model that fails or times out falls back to the word overlap", async () => {
  const { ai } = aiOf({ ok: false, reason: "timeout" });
  const router = smarts(
    [agent("older", "Billing"), agent("newer", "Parcel tracking")],
    ai,
  );

  const routing = await smart(router, "nenu Banglore ki pampinchali");

  assert.equal(routing.agentId, "older");
  assert.equal(routing.via, "fallback");
});

test("a tie is exactly the case worth asking about", async () => {
  const { ai, seen } = aiOf({ ok: true, text: "newer" });
  const router = smarts(
    [agent("older", "Billing", "prices"), agent("newer", "Menu", "prices")],
    ai,
  );

  const routing = await smart(router, "what are the prices?");

  assert.equal(seen.length, 1);
  assert.equal(routing.agentId, "newer");
  assert.equal(routing.via, "model");
});

test("with no key configured the old router is the only router", async () => {
  const { ai, seen } = aiOf({ ok: true, text: "newer" }, false);
  const router = smarts(
    [agent("older", "Billing"), agent("newer", "Parcel tracking")],
    ai,
  );

  const routing = await smart(router, "nenu Banglore ki pampinchali");

  assert.equal(routing.agentId, "older");
  assert.equal(routing.via, "local");
  assert.equal(seen.length, 0);
});
