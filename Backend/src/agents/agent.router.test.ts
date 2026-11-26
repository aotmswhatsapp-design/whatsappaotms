import assert from "node:assert/strict";
import { test } from "node:test";

import { AgentRouter } from "./agent.router";

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
