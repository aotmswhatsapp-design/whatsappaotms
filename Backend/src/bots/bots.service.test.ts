import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import { BotStore } from "./bot.store";
import { BotsService } from "./bots.service";
import type { BotFlow } from "./bot.card";

const CLAIMS = {} as AuthClaims;

/**
 * Two statements, both raw. The fake stands in for the driver, so what is
 * exercised is the service's scoping and validation, plus the shape the SQL
 * binds — not Postgres.
 */
class FakePrisma {
  /** agentId → workspaceId. Only these agents exist. */
  readonly agents = new Map<string, string>([["agent-1", "ws-a"]]);

  /** What the table holds, keyed like the unique index on `agent_id`. */
  readonly rows = new Map<string, { workspaceId: string; flow: unknown }>();

  /** Set to make the table look absent, which is true until the migration runs. */
  missing = false;

  readonly agent = {
    findFirst: async ({ where }: { where: { id: string; workspaceId: string } }) =>
      this.agents.get(where.id) === where.workspaceId ? { id: where.id } : null,
  };

  async $queryRaw(_strings: TemplateStringsArray, ...values: unknown[]) {
    if (this.missing) throw new Error('relation "bot_flows" does not exist');

    const row = this.rows.get(String(values[0]));

    return row ? [{ data: row.flow }] : [];
  }

  async $executeRaw(_strings: TemplateStringsArray, ...values: unknown[]) {
    if (this.missing) throw new Error('relation "bot_flows" does not exist');

    const [workspaceId, agentId, data] = values;

    this.rows.set(String(agentId), {
      workspaceId: String(workspaceId),
      flow: JSON.parse(String(data)),
    });

    return 1;
  }
}

const build = (prisma = new FakePrisma()) =>
  new BotsService(
    prisma as never,
    { primaryFor: async () => ({ workspaceId: "ws-a", userId: "user-a", role: "OWNER" }) } as never,
    new BotStore(prisma as never),
  );

const card = (id: string) => ({
  id,
  title: id,
  imageUrl: null,
  info: "Dosa 80.",
  buttons: [],
});

test("an agent nobody has written yet reads as its own empty flow", async () => {
  const bots = build();
  const view = await bots.read(CLAIMS, "agent-1");

  assert.equal(view.stored, false);
  assert.equal(view.flow.id, "agent-1");
  assert.deepEqual(view.flow.cards, []);
});

test("a saved flow comes back from the table", async () => {
  const bots = build();

  await bots.save(CLAIMS, "agent-1", {
    flow: { id: "whatever", rootCardId: "c-root", cards: [card("c-root")] },
  });

  const view = await bots.read(CLAIMS, "agent-1");

  assert.equal(view.stored, true);
  assert.equal(view.flow.cards[0]?.id, "c-root");
});

test("the flow id is the agent's, whatever the client sent", async () => {
  const bots = build();
  const view = await bots.save(CLAIMS, "agent-1", {
    flow: { id: "client-generated", rootCardId: null, cards: [] } satisfies BotFlow,
  });

  assert.equal(view.flow.id, "agent-1");
});

test("an agent in another workspace does not exist", async () => {
  const prisma = new FakePrisma();

  prisma.agents.set("agent-1", "ws-other");

  await assert.rejects(() => build(prisma).read(CLAIMS, "agent-1"), NotFoundException);
});

test("a flow that points outside itself is refused before anything is written", async () => {
  const prisma = new FakePrisma();

  await assert.rejects(
    () =>
      build(prisma).save(CLAIMS, "agent-1", {
        flow: {
          id: "agent-1",
          rootCardId: null,
          cards: [
            {
              ...card("c-root"),
              buttons: [
                { id: "b-1", label: "Gone", action: { kind: "card", cardId: "c-missing" } },
              ],
            },
          ],
        },
      }),
    (error: any) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === "BOT_FLOW_INVALID",
  );

  assert.equal(prisma.rows.size, 0);
});

test("a database without the table answers 503 with the file that installs it", async () => {
  const prisma = new FakePrisma();

  prisma.missing = true;

  await assert.rejects(
    () => build(prisma).read(CLAIMS, "agent-1"),
    (error: any) =>
      error instanceof ServiceUnavailableException &&
      (error.getResponse() as { code?: string }).code === "BOT_STORE_MISSING" &&
      /0025_bot_flows/.test((error.getResponse() as { message?: string }).message ?? ""),
  );
});
