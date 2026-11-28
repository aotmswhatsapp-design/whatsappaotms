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
  readonly agents = new Map<string, string>([
    ["agent-1", "ws-a"],
    ["agent-2", "ws-a"],
  ]);

  /** What the table holds, keyed like the unique index on `agent_id`. */
  readonly rows = new Map<string, { workspaceId: string; flow: unknown }>();

  /** Set to make the table look absent, which is true until the migration runs. */
  missing = false;

  readonly agent = {
    findFirst: async ({ where }: { where: { id: string; workspaceId: string } }) =>
      this.agents.get(where.id) === where.workspaceId ? { id: where.id } : null,
  };

  async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
    if (this.missing) throw new Error('relation "bot_flows" does not exist');

    // Two reads: one flow by agent, and every flow in a workspace — the
    // second is what the upload guard asks, because a card can be shifted
    // into another agent's bot and keep the address it was uploaded under.
    if (strings.join("").includes('"workspace_id"')) {
      return [...this.rows.entries()]
        .filter(([, row]) => row.workspaceId === String(values[0]))
        .map(([agentId, row]) => ({ agentId, data: row.flow }));
    }

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

const build = (
  prisma = new FakePrisma(),
  removed: string[] = [],
  /** What the fake bucket lists, when a test is about the library. */
  objects: { name: string; updatedAt: string | null }[] = [],
) =>
  new BotsService(
    prisma as never,
    { primaryFor: async () => ({ workspaceId: "ws-a", userId: "user-a", role: "OWNER" }) } as never,
    new BotStore(prisma as never),
    {
      upload: async () => undefined,
      list: async () => objects,
      publicUrl: (path: string) => `https://storage.test/${path}`,
      remove: async (paths: string[]) => {
        removed.push(...paths);
      },
    } as never,
  );

const card = (id: string) => ({
  id,
  name: id,
  title: id,
  imageUrls: [],
  files: [],
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

test("a card saved before names existed is labelled by its heading", async () => {
  const prisma = new FakePrisma();

  // No `name` key at all, which is how every card written by an earlier build
  // is stored. The heading was its only label, so it stays the label.
  prisma.rows.set("agent-1", {
    workspaceId: "ws-a",
    flow: {
      id: "agent-1",
      rootCardId: "c-menu",
      cards: [
        {
          id: "c-menu",
          title: "Menu",
          imageUrls: [],
          info: "Dosa 80.",
          buttons: [],
        },
      ],
      rules: [],
    },
  });

  const view = await build(prisma).read(CLAIMS, "agent-1");

  assert.equal(view.flow.cards[0]?.name, "Menu");
});

test("a card saved with an empty name stays unnamed, whatever its heading says", async () => {
  const prisma = new FakePrisma();

  prisma.rows.set("agent-1", {
    workspaceId: "ws-a",
    flow: {
      id: "agent-1",
      rootCardId: "c-menu",
      cards: [
        {
          id: "c-menu",
          name: "",
          title: "Menu",
          imageUrls: [],
          info: "Dosa 80.",
          buttons: [],
        },
      ],
      rules: [],
    },
  });

  const view = await build(prisma).read(CLAIMS, "agent-1");

  assert.equal(view.flow.cards[0]?.name, "");
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

test("shifting a card moves it into the other agent's flow and out of this one", async () => {
  const prisma = new FakePrisma();
  const bots = build(prisma);

  await bots.save(CLAIMS, "agent-1", {
    flow: {
      id: "agent-1",
      rootCardId: "c-menu",
      cards: [card("c-menu"), card("c-drinks")],
    },
  });

  const answer = await bots.shift(CLAIMS, "agent-1", {
    targetAgentId: "agent-2",
    cardIds: ["c-drinks"],
    mode: "move",
  });

  assert.deepEqual(
    answer.flow.cards.map((row) => row.id),
    ["c-menu"],
  );
  assert.equal(answer.targetAgentId, "agent-2");

  const target = await bots.read(CLAIMS, "agent-2");

  assert.equal(target.stored, true);
  assert.equal(target.flow.cards.length, 1);
  assert.equal(target.flow.cards[0]?.name, "c-drinks");
  // The id is the target's own: an id is only unique inside one flow.
  assert.match(target.flow.cards[0]?.id ?? "", /^card-/);
  // An agent that had no entry starts on the card it was given.
  assert.equal(target.flow.rootCardId, target.flow.cards[0]?.id);
});

test("a move repairs the source's dangling button and its rule, in the table too", async () => {
  const prisma = new FakePrisma();
  const bots = build(prisma);

  await bots.save(CLAIMS, "agent-1", {
    flow: {
      id: "agent-1",
      rootCardId: "c-menu",
      cards: [
        {
          ...card("c-menu"),
          buttons: [
            { id: "b-1", label: "Drinks", action: { kind: "card", cardId: "c-drinks" } },
          ],
        },
        card("c-drinks"),
      ],
      rules: [{ id: "r-1", triggers: ["drinks"], replyCardId: "c-drinks", enabled: true }],
    },
  });

  const answer = await bots.shift(CLAIMS, "agent-1", {
    targetAgentId: "agent-2",
    cardIds: ["c-drinks"],
    mode: "move",
  });

  assert.equal(answer.repairs.sourceButtons, 1);
  assert.equal(answer.repairs.sourceRules, 1);
  assert.deepEqual(answer.flow.rules, []);
  assert.deepEqual(answer.flow.cards[0]?.buttons[0]?.action, { kind: "handoff" });

  const stored = await bots.read(CLAIMS, "agent-1");

  assert.deepEqual(stored.flow.cards[0]?.buttons[0]?.action, { kind: "handoff" });
});

test("a copy leaves this agent's flow exactly as it was", async () => {
  const prisma = new FakePrisma();
  const bots = build(prisma);

  await bots.save(CLAIMS, "agent-1", {
    flow: { id: "agent-1", rootCardId: "c-menu", cards: [card("c-menu")] },
  });

  const answer = await bots.shift(CLAIMS, "agent-1", {
    targetAgentId: "agent-2",
    cardIds: ["c-menu"],
    mode: "copy",
  });

  assert.deepEqual(
    answer.flow.cards.map((row) => row.id),
    ["c-menu"],
  );

  const source = await bots.read(CLAIMS, "agent-1");
  const target = await bots.read(CLAIMS, "agent-2");

  assert.equal(source.flow.cards[0]?.id, "c-menu");
  assert.equal(target.flow.cards.length, 1);
  assert.notEqual(target.flow.cards[0]?.id, "c-menu");
});

test("shifting to the agent that owns the cards is refused", async () => {
  await assert.rejects(
    () =>
      build().shift(CLAIMS, "agent-1", {
        targetAgentId: "agent-1",
        cardIds: ["c-menu"],
        mode: "move",
      }),
    (error: any) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === "BOT_SHIFT_SAME_AGENT",
  );
});

test("a card cannot be shifted into another workspace's agent", async () => {
  const prisma = new FakePrisma();

  prisma.agents.set("agent-2", "ws-other");

  await assert.rejects(
    () =>
      build(prisma).shift(CLAIMS, "agent-1", {
        targetAgentId: "agent-2",
        cardIds: ["c-menu"],
        mode: "move",
      }),
    NotFoundException,
  );
});

test("an agent with no saved flow has nothing to shift", async () => {
  await assert.rejects(
    () =>
      build().shift(CLAIMS, "agent-1", {
        targetAgentId: "agent-2",
        cardIds: ["c-menu"],
        mode: "move",
      }),
    (error: any) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === "BOT_FLOW_EMPTY",
  );
});

test("a card that is not in the flow is refused, and neither row is written", async () => {
  const prisma = new FakePrisma();
  const bots = build(prisma);

  await bots.save(CLAIMS, "agent-1", {
    flow: { id: "agent-1", rootCardId: null, cards: [card("c-menu")] },
  });

  await assert.rejects(
    () =>
      bots.shift(CLAIMS, "agent-1", {
        targetAgentId: "agent-2",
        cardIds: ["c-gone"],
        mode: "move",
      }),
    (error: any) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === "BOT_SHIFT_REFUSED",
  );

  // Only the flow that was saved before the attempt is in the table.
  assert.deepEqual([...prisma.rows.keys()], ["agent-1"]);
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

  const answer = await build(prisma, removed).removeMedia(CLAIMS, "agent-1", PICTURE);

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
    () => build(prisma, removed).removeMedia(CLAIMS, "agent-1", PICTURE),
    (error: any) =>
      error instanceof ConflictException &&
      (error.getResponse() as { code?: string }).code === "BOT_MEDIA_IN_USE" &&
      /c-menu/.test((error.getResponse() as { message?: string }).message ?? ""),
  );

  assert.deepEqual(removed, []);
});

test("an upload a card on another agent still sends is refused here", async () => {
  const removed: string[] = [];
  const prisma = new FakePrisma();

  // Shifted to agent-2, keeping the address it was uploaded under, so the
  // guard has to look past this agent's own flow.
  prisma.rows.set("agent-2", {
    workspaceId: "ws-a",
    flow: {
      id: "agent-2",
      rootCardId: "c-moved",
      cards: [{ ...card("c-moved"), imageUrls: [PICTURE_URL] }],
      rules: [],
    },
  });

  await assert.rejects(
    () => build(prisma, removed).removeMedia(CLAIMS, "agent-1", PICTURE),
    (error: any) =>
      error instanceof ConflictException &&
      (error.getResponse() as { code?: string }).code === "BOT_MEDIA_IN_USE" &&
      /another agent's bot/.test(
        (error.getResponse() as { message?: string }).message ?? "",
      ),
  );

  assert.deepEqual(removed, []);
});

test("a picture in another workspace's folder is unknown, not forbidden", async () => {
  const removed: string[] = [];

  await assert.rejects(
    () =>
      build(new FakePrisma(), removed).removeMedia(
        CLAIMS,
        "agent-1",
        "bots/ws-b/agent-1/abc.jpg",
      ),
    (error: any) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === "BOT_MEDIA_UNKNOWN",
  );

  assert.deepEqual(removed, []);
});

test("a path that climbs out of the folder is refused", async () => {
  const removed: string[] = [];

  await assert.rejects(
    () =>
      build(new FakePrisma(), removed).removeMedia(
        CLAIMS,
        "agent-1",
        "bots/ws-a/agent-1/../../ws-b/agent-1/abc.jpg",
      ),
    (error: any) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === "BOT_MEDIA_UNKNOWN",
  );

  assert.deepEqual(removed, []);
});

test("a database without the flow table still lets a picture be removed", async () => {
  const removed: string[] = [];
  const prisma = new FakePrisma();

  prisma.missing = true;

  await build(prisma, removed).removeMedia(CLAIMS, "agent-1", PICTURE);

  assert.deepEqual(removed, [PICTURE]);
});

/** A real 1×1 PNG, so the image arm is exercised by real bytes. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

const upload = (patch: { buffer: Buffer; mimetype: string; originalname: string }) => ({
  ...patch,
  size: patch.buffer.length,
});

test("a PDF is stored as a file, under the name the customer will see", async () => {
  const stored = await build().uploadMedia(
    CLAIMS,
    "agent-1",
    upload({
      buffer: Buffer.from("%PDF-1.7\nMenu\n"),
      mimetype: "application/pdf",
      originalname: "Price list.pdf",
    }),
  );

  assert.equal(stored.type, "file");
  if (stored.type !== "file") return;

  assert.equal(stored.kind, "document");
  assert.equal(stored.name, "Price list.pdf");
  assert.match(stored.path, /^bots\/ws-a\/agent-1\/.+__Price list\.pdf$/);
  assert.equal(stored.url, `https://storage.test/${stored.path}`);
});

test("a picture still goes down the picture path, re-encoded as a JPEG", async () => {
  const stored = await build().uploadMedia(
    CLAIMS,
    "agent-1",
    upload({ buffer: PNG, mimetype: "image/png", originalname: "logo.png" }),
  );

  assert.equal(stored.type, "image");
  if (stored.type !== "image") return;

  assert.equal(stored.width, 1);
  assert.match(stored.path, /\.jpg$/);
});

test("a file that is not one we send is refused with a code the screen can read", async () => {
  await assert.rejects(
    () =>
      build().uploadMedia(
        CLAIMS,
        "agent-1",
        upload({
          buffer: Buffer.from("MZ"),
          mimetype: "application/x-msdownload",
          originalname: "installer.exe",
        }),
      ),
    (error: any) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === "BOT_FILE_INVALID",
  );
});

/** A path and address this agent really owns, for a document. */
const FILE = "bots/ws-a/agent-1/abc__Menu.pdf";
const FILE_URL = `https://storage.test/${FILE}`;

test("a file a saved card sends is refused, naming the card", async () => {
  const removed: string[] = [];
  const prisma = new FakePrisma();

  prisma.rows.set("agent-1", {
    workspaceId: "ws-a",
    flow: {
      id: "agent-1",
      rootCardId: "c-menu",
      cards: [
        {
          ...card("c-menu"),
          files: [{ url: FILE_URL, name: "Menu.pdf", kind: "document" }],
        },
      ],
      rules: [],
    },
  });

  await assert.rejects(
    () => build(prisma, removed).removeMedia(CLAIMS, "agent-1", FILE),
    (error: any) =>
      error instanceof ConflictException &&
      (error.getResponse() as { code?: string }).code === "BOT_MEDIA_IN_USE" &&
      /c-menu/.test((error.getResponse() as { message?: string }).message ?? ""),
  );

  assert.deepEqual(removed, []);
});

test("the library tells pictures from the files handed over with a card", async () => {
  const library = await build(new FakePrisma(), [], [
    { name: "aaa.jpg", updatedAt: null },
    { name: "bbb__Menu.pdf", updatedAt: null },
    { name: "ccc__Tour.mp4", updatedAt: null },
  ]).mediaLibrary(CLAIMS, "agent-1");

  assert.deepEqual(
    library.images.map((image) => image.path),
    ["bots/ws-a/agent-1/aaa.jpg"],
  );

  // Newest first, which is the listing reversed: the names start with a stamp.
  assert.deepEqual(
    library.files.map((file) => [file.name, file.kind]),
    [
      ["Tour.mp4", "video"],
      ["Menu.pdf", "document"],
    ],
  );
});
