import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaService } from "../prisma/prisma.service";
import type { ParsedChange, ParsedMessage } from "./inbox.payload";
import { InboxStore } from "./inbox.store";

/**
 * The echo path is a second writer into tables the inbound path already owns,
 * so what these tests read is the arguments handed to Prisma: direction and
 * status on the row, and — the part that is easy to get wrong — the columns a
 * coexistence echo must not touch.
 */

const account = { id: "acct-1", workspaceId: "ws-1", phoneNumberId: "pn-1" };

const at = new Date("2026-11-27T10:00:00Z");

function echo(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    // The parser puts the customer in `from` even for an echo, so the thread
    // keying is the same one inbound uses.
    from: "919900000000",
    wamid: "wamid.echo-1",
    timestamp: at,
    kind: "TEXT",
    body: "On my way",
    mediaId: null,
    mediaMime: null,
    mediaName: null,
    mediaSha256: null,
    contextWamid: null,
    payload: null,
    ...overrides,
  };
}

function change(overrides: Partial<ParsedChange> = {}): ParsedChange {
  return {
    phoneNumberId: "pn-1",
    contacts: [],
    messages: [],
    echoes: [],
    statuses: [],
    ...overrides,
  };
}

function fake(options: { lastMessageAt?: Date; existingWamid?: boolean } = {}) {
  const conversationCreates: Record<string, unknown>[] = [];
  const conversationUpdates: Record<string, unknown>[] = [];
  const messageCreates: Record<string, unknown>[] = [];

  const prisma = {
    contact: { upsert: async () => ({ id: "contact-1" }) },
    conversation: {
      upsert: async (args: { create: Record<string, unknown> }) => {
        conversationCreates.push(args.create);
        return { id: "conv-1", lastMessageAt: options.lastMessageAt ?? at };
      },
      update: async (args: { data: Record<string, unknown> }) => {
        conversationUpdates.push(args.data);
        return {};
      },
    },
    message: {
      findUnique: async () => (options.existingWamid ? { id: "msg-old" } : null),
      create: async (args: { data: Record<string, unknown> }) => {
        messageCreates.push(args.data);
        return { id: "msg-1" };
      },
      deleteMany: async () => ({ count: 0 }),
    },
  } as unknown as PrismaService;

  return {
    store: new InboxStore(prisma),
    conversationCreates,
    conversationUpdates,
    messageCreates,
  };
}

test("an echo is stored as seen by the business, not as something to answer", async () => {
  const { store, conversationCreates, messageCreates } = fake();

  const stored = await store.record(account, [change({ echoes: [echo()] })]);

  // Nobody replies to their own message: the intake pipeline only ever sees
  // inbound rows, and an echo must not reach it.
  assert.deepEqual(stored, []);
  assert.equal(conversationCreates[0].unreadCount, 0);
  assert.equal(messageCreates[0].direction, "OUTBOUND");
  assert.equal(messageCreates[0].status, "SENT");
  assert.equal(messageCreates[0].wamid, "wamid.echo-1");
});

test("an echo never opens or extends the customer-service window", async () => {
  const { store, conversationCreates, conversationUpdates } = fake();

  await store.record(account, [change({ echoes: [echo()] })]);

  // Meta is explicit that a WhatsApp Business app message is not a Cloud API
  // message: it leaves the 24-hour window exactly where it was.
  assert.equal("lastInboundAt" in conversationCreates[0], false);
  assert.equal("lastInboundAt" in conversationUpdates[0], false);
  assert.equal("unreadCount" in conversationUpdates[0], false);
});

test("a retried echo writes no second row", async () => {
  const { store, messageCreates, conversationUpdates } = fake({
    existingWamid: true,
  });

  await store.record(account, [change({ echoes: [echo()] })]);

  assert.equal(messageCreates.length, 0);
  assert.equal(conversationUpdates.length, 0);
});

test("an old echo does not drag the thread back to the top of the list", async () => {
  const later = new Date("2026-11-27T12:00:00Z");
  const { store, conversationUpdates } = fake({ lastMessageAt: later });

  await store.record(account, [change({ echoes: [echo()] })]);

  assert.equal(conversationUpdates.length, 0);
});

test("inbound still counts as unread and opens the window", async () => {
  const { store, conversationCreates, conversationUpdates, messageCreates } = fake();

  const stored = await store.record(account, [
    change({ messages: [echo({ wamid: "wamid.in-1", body: "Two dosas" })] }),
  ]);

  assert.equal(stored.length, 1);
  assert.equal(stored[0].conversationId, "conv-1");
  assert.equal(conversationCreates[0].unreadCount, 1);
  assert.equal(conversationCreates[0].lastInboundAt, at);
  assert.equal(conversationUpdates[0].lastInboundAt, at);
  assert.deepEqual(conversationUpdates[0].unreadCount, { increment: 1 });
  assert.equal(messageCreates[0].direction, "INBOUND");
  assert.equal(messageCreates[0].status, "DELIVERED");
});
