import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BadRequestException,
  ConflictException,
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

const build = (prisma = new FakePrisma(), removed: string[] = []) =>
  new BotsService(
    prisma as never,
    { primaryFor: async () => ({ workspaceId: "ws-a", userId: "user-a", role: "OWNER" }) } as never,
    new BotStore(prisma as never),
    {
      upload: async () => undefined,
      list: async () => [],
      publicUrl: (path: string) => `https://storage.test/${path}`,
      remove: async (paths: string[]) => {
        removed.push(...paths);
      },
    } as never,
  );

const card = (id: string) => ({
  id,
  title: id,
  imageUrls: [],
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

test("a stored flow is read as this agent's, whatever id it carries", async () => {
  const prisma = new FakePrisma();

  // Written straight into the fake, as a row from an older build would be:
  // the document's own id names another agent.
  prisma.rows.set("agent-1", {
    workspaceId: "ws-a",
    flow: { id: "agent-2", rootCardId: null, cards: [], rules: [] },
  });

  const view = await build(prisma).read(CLAIMS, "agent-1");

  assert.equal(view.flow.id, "agent-1");
});

test("the flow id is the agent's, whatever the client sent", async () => {
  const bots = build();
  const view = await bots.save(CLAIMS, "agent-1", {
    flow: { id: "client-generated", rootCardId: null, cards: [], rules: [] } satisfies BotFlow,
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

test("a rule that replies with a card outside the flow is refused", async () => {
  const prisma = new FakePrisma();

  await assert.rejects(
    () =>
      build(prisma).save(CLAIMS, "agent-1", {
        flow: {
          id: "agent-1",
          rootCardId: null,
          cards: [card("c-root")],
          rules: [
            { id: "r-1", triggers: ["hi"], replyCardId: "c-missing", enabled: true },
          ],
        },
      }),
    (error: any) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === "BOT_FLOW_INVALID",
  );
});

test("a saved rule comes back with its triggers in order", async () => {
  const bots = build();

  await bots.save(CLAIMS, "agent-1", {
    flow: {
      id: "agent-1",
      rootCardId: null,
      cards: [card("c-welcome")],
      rules: [
        { id: "r-1", triggers: ["hi", "hello"], replyCardId: "c-welcome", enabled: true },
      ],
    },
  });

  const view = await bots.read(CLAIMS, "agent-1");

  assert.deepEqual(view.flow.rules, [
    { id: "r-1", triggers: ["hi", "hello"], replyCardId: "c-welcome", enabled: true },
  ]);
});

test("a database without the table answers 503 with the migration that installs it", async () => {
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

/** A path this agent really owns, in the fake storage's public-url shape. */
const PICTURE = "bots/ws-a/agent-1/abc.jpg";

/** What `publicUrl` answers for that path — the address a card stores. */
const PICTURE_URL = `https://storage.test/${PICTURE}`;

test("a picture no card points at is deleted from storage", async () => {
  const removed: string[] = [];
  const prisma = new FakePrisma();

  prisma.rows.set("agent-1", {
    workspaceId: "ws-a",
    flow: { id: "agent-1", rootCardId: null, cards: [card("c-root")], rules: [] },
  });

  const answer = await build(prisma, removed).removeImage(CLAIMS, "agent-1", PICTURE);

  assert.deepEqual(answer, { removed: true });
  assert.deepEqual(removed, [PICTURE]);
});

test("a picture a saved card still shows is refused, naming the card", async () => {
  const removed: string[] = [];
  const prisma = new FakePrisma();

  prisma.rows.set("agent-1", {
    workspaceId: "ws-a",
    flow: {
      id: "agent-1",
      rootCardId: "c-menu",
      cards: [{ ...card("c-menu"), imageUrls: [PICTURE_URL] }],
      rules: [],
    },
  });

  await assert.rejects(
    () => build(prisma, removed).removeImage(CLAIMS, "agent-1", PICTURE),
    (error: any) =>
      error instanceof ConflictException &&
      (error.getResponse() as { code?: string }).code === "BOT_IMAGE_IN_USE" &&
      /c-menu/.test((error.getResponse() as { message?: string }).message ?? ""),
  );

  assert.deepEqual(removed, []);
});

test("a picture in another workspace's folder is unknown, not forbidden", async () => {
  const removed: string[] = [];

  await assert.rejects(
    () =>
      build(new FakePrisma(), removed).removeImage(
        CLAIMS,
        "agent-1",
        "bots/ws-b/agent-1/abc.jpg",
      ),
    (error: any) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === "BOT_IMAGE_UNKNOWN",
  );

  assert.deepEqual(removed, []);
});

test("a path that climbs out of the folder is refused", async () => {
  const removed: string[] = [];

  await assert.rejects(
    () =>
      build(new FakePrisma(), removed).removeImage(
        CLAIMS,
        "agent-1",
        "bots/ws-a/agent-1/../../ws-b/agent-1/abc.jpg",
      ),
    (error: any) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === "BOT_IMAGE_UNKNOWN",
  );

  assert.deepEqual(removed, []);
});

test("a database without the flow table still lets a picture be removed", async () => {
  const removed: string[] = [];
  const prisma = new FakePrisma();

  prisma.missing = true;

  await build(prisma, removed).removeImage(CLAIMS, "agent-1", PICTURE);

  assert.deepEqual(removed, [PICTURE]);
});
