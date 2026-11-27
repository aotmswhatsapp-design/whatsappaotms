import assert from "node:assert/strict";
import { test } from "node:test";

import type { BotCard, BotFlow } from "../bots/bot.card";
import { InboxSender } from "./inbox.sender";
import type { MessageSource } from "./inbox.view";

/**
 * The sender's new shape: a card may leave as several messages.
 *
 * These tests pin the two promises the thread and the customer depend on —
 * pictures go first, in the card's order, and a picture Meta refuses never
 * stops the card that follows it. Everything else (rows, tokens, storage) is
 * faked at the seam, because the question here is the order of the calls, not
 * how Prisma or Supabase behave.
 */

const ACCOUNT = {
  phoneNumberId: "pn-1",
  graphVersion: "v21.0",
  accessTokenCipher: "cipher",
};

const storageUrl = (name: string) => `https://storage.test/bot-media/${name}`;

const PICTURES = [storageUrl("one.jpg"), storageUrl("two.jpg")];

const card = (patch: Partial<BotCard> = {}): BotCard => ({
  id: "c-menu",
  title: "Menu",
  imageUrls: [],
  info: "Dosa 80.",
  buttons: [{ id: "b-drinks", label: "Drinks", action: { kind: "handoff" } }],
  ...patch,
});

const flow = (one: BotCard): BotFlow => ({
  id: "agent-1",
  rootCardId: one.id,
  cards: [one],
  rules: [],
});

function row(patch: Partial<MessageSource> = {}): MessageSource {
  return {
    id: "m-1",
    wamid: null,
    direction: "OUTBOUND",
    kind: "TEXT",
    imported: false,
    agentId: null,
    status: "QUEUED",
    body: null,
    templateName: null,
    templateLanguage: null,
    tapTarget: null,
    mediaId: null,
    mediaMime: null,
    mediaName: null,
    mediaSize: null,
    mediaPath: null,
    errorReason: null,
    contextWamid: null,
    payload: null,
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    createdAt: new Date("2026-11-27T10:00:00Z"),
    ...patch,
  };
}

class FakePrisma {
  readonly rows = new Map<string, MessageSource>();
  private seq = 0;

  readonly message = {
    create: async ({ data }: { data: Partial<MessageSource> }) => {
      const created = row({ ...data, id: `m-${++this.seq}` });

      this.rows.set(created.id, created);

      return created;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<MessageSource>;
    }) => {
      const current = this.rows.get(where.id);

      assert.ok(current, "the sender updates a row it just created");

      const next = { ...current, ...data };

      this.rows.set(where.id, next);

      return next;
    },
  };

  readonly conversation = {
    update: async () => ({}),
  };
}

/** Records the send calls in order, and refuses exactly one picture. */
class FakeGraph {
  readonly sent: { kind: "image" | "interactive" | "text"; link?: string }[] = [];
  refuse: string | null = null;
  private seq = 0;

  async sendImageLink(input: { link: string }): Promise<string> {
    if (input.link === this.refuse) {
      throw new Error("Meta refused this picture.");
    }

    this.sent.push({ kind: "image", link: input.link });

    return `wamid.image.${++this.seq}`;
  }

  async sendInteractive(): Promise<string> {
    this.sent.push({ kind: "interactive" });

    return `wamid.card.${++this.seq}`;
  }

  async sendText(): Promise<string> {
    this.sent.push({ kind: "text" });

    return `wamid.text.${++this.seq}`;
  }
}

/** Our own public bucket answers a path; anybody else's address does not. */
const storage = {
  pathInPublicUrl: (url: string): string | null => {
    const prefix = "https://storage.test/bot-media/";

    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  },
};

const box = { open: () => "token" };

function sender(graph: FakeGraph, prisma = new FakePrisma()): InboxSender {
  return new InboxSender(
    prisma as unknown as never,
    graph as unknown as never,
    storage as unknown as never,
    box as unknown as never,
  );
}

const target = {
  workspaceId: "ws-a",
  conversationId: "conv-1",
  waId: "919876543210",
  account: ACCOUNT,
};

test("several pictures are sent first, in order, and the card last", async () => {
  const graph = new FakeGraph();
  const feed = sender(graph);
  const one = card({ imageUrls: PICTURES });

  const result = await feed.interactive({
    ...target,
    flow: flow(one),
    card: one,
    quote: null,
  });

  assert.deepEqual(graph.sent, [
    { kind: "image", link: PICTURES[0] },
    { kind: "image", link: PICTURES[1] },
    { kind: "interactive" },
  ]);
  assert.equal(result.photos.length, 2);
  assert.ok(result.photos.every((photo) => photo.kind === "IMAGE"));
  assert.equal(result.message.status, "SENT");
  assert.equal(result.message.card?.id, one.id, "the card travels with its snapshot");
  assert.equal(
    result.message.payload,
    null,
    "a card is drawn from `card`, not from the location/contact reader",
  );
});

test("a refused picture is recorded, and the card is still delivered", async () => {
  const graph = new FakeGraph();
  const feed = sender(graph);
  const one = card({ imageUrls: PICTURES });

  graph.refuse = PICTURES[1];

  const result = await feed.interactive({
    ...target,
    flow: flow(one),
    card: one,
    quote: null,
  });

  assert.deepEqual(graph.sent, [
    { kind: "image", link: PICTURES[0] },
    { kind: "interactive" },
  ]);
  assert.equal(result.photos.length, 2);
  assert.equal(result.photos[0]?.status, "SENT");
  assert.equal(result.photos[1]?.status, "FAILED");
  assert.match(result.photos[1]?.errorReason ?? "", /refused this picture/);
  assert.equal(result.message.status, "SENT", "the card does not depend on its pictures");
});

test("one picture on a card with buttons is the header, not a message of its own", async () => {
  const graph = new FakeGraph();
  const feed = sender(graph);
  const one = card({ imageUrls: [PICTURES[0]] });

  const result = await feed.interactive({
    ...target,
    flow: flow(one),
    card: one,
    quote: null,
  });

  assert.deepEqual(graph.sent, [{ kind: "interactive" }]);
  assert.deepEqual(result.photos, []);
});

test("a picture from somebody else keeps its link, ours keeps a stored path", async () => {
  const graph = new FakeGraph();
  const prisma = new FakePrisma();
  const feed = sender(graph, prisma);
  const pasted = "https://example.com/elsewhere.jpg";
  const one = card({ imageUrls: [pasted, PICTURES[0]] });

  await feed.interactive({
    ...target,
    flow: flow(one),
    card: one,
    quote: null,
  });

  const photos = [...prisma.rows.values()].filter((entry) => entry.kind === "IMAGE");
  const ours = photos.find((entry) => entry.mediaPath !== null);
  const theirs = photos.find((entry) => entry.mediaPath === null);

  assert.equal(ours?.mediaPath, "one.jpg");
  assert.deepEqual(ours?.payload, { image: { link: PICTURES[0] } });
  assert.deepEqual(theirs?.payload, { image: { link: pasted } });
});