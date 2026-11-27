import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaService } from "../prisma/prisma.service";
import type {
  HistoryMessage,
  HistoryThread,
  MediaAsset,
} from "../whatsapp/coexistence";
import { HistoryStore } from "./history.store";

/**
 * Imported history is a second writer into tables the live path owns, with one
 * extra promise: it must not look like a conversation that just happened.
 * These tests read the statements handed to Prisma for exactly that.
 */

const account = {
  id: "acct-1",
  workspaceId: "ws-1",
  phoneNumberId: "pn-1",
  displayPhoneNumber: "+1 650 555 1234",
};

const recent = new Date(Date.now() - 60 * 60 * 1000);
const old = new Date("2026-01-02T10:00:00Z");

function message(overrides: Partial<HistoryMessage> = {}): HistoryMessage {
  return {
    wamid: "wamid.in-1",
    direction: "INBOUND",
    kind: "TEXT",
    status: "DELIVERED",
    body: "Two dosas",
    mediaId: null,
    mediaMime: null,
    mediaSha256: null,
    errorReason: null,
    at: recent,
    ...overrides,
  };
}

function thread(overrides: Partial<HistoryThread> = {}): HistoryThread {
  return {
    phoneNumberId: "pn-1",
    phone: "919900000000",
    bsuid: null,
    username: null,
    messages: [message()],
    ...overrides,
  };
}

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    phoneNumberId: "pn-1",
    wamid: "wamid.media",
    from: "919900000000",
    kind: "IMAGE",
    mediaId: "media-1",
    mediaMime: "image/jpeg",
    mediaSha256: "abc",
    caption: "The menu",
    at: recent,
    ...overrides,
  };
}

function fake(
  options: { filled?: number; existingWamid?: boolean; written?: number } = {},
) {
  const conversationCreates: Record<string, unknown>[] = [];
  const conversationUpdates: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }[] = [];
  const messageBatches: Record<string, unknown>[][] = [];
  const messageCreates: Record<string, unknown>[] = [];
  const contactUpserts: Record<string, unknown>[] = [];
  const accountUpdates: Record<string, unknown>[] = [];

  const prisma = {
    contact: {
      upsert: async (args: { create: Record<string, unknown> }) => {
        contactUpserts.push(args.create);
        return { id: "contact-1" };
      },
    },
    conversation: {
      upsert: async (args: { create: Record<string, unknown> }) => {
        conversationCreates.push(args.create);
        return { id: "conv-1" };
      },
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        conversationUpdates.push(args);
        return { count: 0 };
      },
    },
    message: {
      createMany: async (args: { data: Record<string, unknown>[] }) => {
        messageBatches.push(args.data);
        return { count: options.written ?? args.data.length };
      },
      updateMany: async () => ({ count: options.filled ?? 0 }),
      findUnique: async () =>
        options.existingWamid ? { id: "msg-live" } : null,
      create: async (args: { data: Record<string, unknown> }) => {
        messageCreates.push(args.data);
        return { id: "msg-1" };
      },
    },
    whatsAppAccount: {
      update: async (args: { data: Record<string, unknown> }) => {
        accountUpdates.push(args.data);
        return {};
      },
    },
  } as unknown as PrismaService;

  return {
    store: new HistoryStore(prisma),
    conversationCreates,
    conversationUpdates,
    messageBatches,
    messageCreates,
    contactUpserts,
    accountUpdates,
  };
}

test("history is imported as imported, and never as unread", async () => {
  const { store, conversationCreates, messageBatches } = fake();

  const result = await store.import(account, [thread()]);

  assert.deepEqual(result, { written: 1, skipped: 0 });
  assert.equal(conversationCreates[0].unreadCount, 0);
  assert.equal("lastInboundAt" in conversationCreates[0], false);
  assert.equal(messageBatches[0][0].imported, true);
  assert.equal(messageBatches[0][0].createdAt, recent);
});

test("a retried chunk adds no second row", async () => {
  const { store } = fake({ written: 0 });

  const result = await store.import(account, [thread()]);

  // `createMany` with `skipDuplicates` answers zero for a chunk it has seen.
  assert.deepEqual(result, { written: 0, skipped: 0 });
});

test("an old inbound message does not open the service window", async () => {
  const { store, conversationUpdates } = fake();

  await store.import(account, [thread({ messages: [message({ at: old })] })]);

  // Only the placement update ran; there is no window write at all.
  assert.equal(conversationUpdates.length, 1);
  assert.equal("lastInboundAt" in conversationUpdates[0].data, false);
});

test("a recent inbound message moves the window forward, atomically", async () => {
  const { store, conversationUpdates } = fake();

  await store.import(account, [thread()]);

  const window = conversationUpdates.find((call) => "lastInboundAt" in call.data);

  assert.ok(window, "the window was never moved");
  assert.deepEqual(window.where, {
    id: "conv-1",
    OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: recent } }],
  });
});

test("an older chunk cannot drag the thread back", async () => {
  const { store, conversationUpdates } = fake();

  await store.import(account, [thread({ messages: [message({ at: old })] })]);

  // The comparison lives in the WHERE clause: a read-then-write would lose a
  // newer chunk that landed between the two statements.
  assert.deepEqual(conversationUpdates[0].where, {
    id: "conv-1",
    lastMessageAt: { lt: old },
  });
});

test("a thread with no phone is counted and skipped", async () => {
  const { store, conversationCreates } = fake();

  const result = await store.import(account, [
    thread({
      phone: null,
      bsuid: "IN.1",
      messages: [message(), message({ wamid: "wamid.in-2" })],
    }),
  ]);

  assert.deepEqual(result, { written: 0, skipped: 2 });
  assert.equal(conversationCreates.length, 0);
});

test("a thread for another number is left alone", async () => {
  const { store, conversationCreates } = fake();

  await store.import(account, [thread({ phoneNumberId: "pn-other" })]);

  assert.equal(conversationCreates.length, 0);
});

test("a media asset fills the placeholder it names", async () => {
  const { store, messageCreates } = fake({ filled: 1 });

  await store.attachMedia(account, asset());

  assert.equal(messageCreates.length, 0);
});

test("an inbound asset with no placeholder creates its row", async () => {
  const { store, messageCreates } = fake();

  await store.attachMedia(account, asset());

  assert.equal(messageCreates[0].kind, "IMAGE");
  assert.equal(messageCreates[0].direction, "INBOUND");
  assert.equal(messageCreates[0].imported, true);
  assert.equal(messageCreates[0].wamid, "wamid.media");
});

test("an asset whose sender is the business is left for its own chunk", async () => {
  const { store, messageCreates } = fake();

  await store.attachMedia(account, asset({ from: "16505551234" }));

  // `from` is the business's own number, so the recipient is unknown.
  assert.equal(messageCreates.length, 0);
});

test("an asset whose wamid a live row owns changes nothing", async () => {
  const { store, messageCreates } = fake({ existingWamid: true });

  await store.attachMedia(account, asset());

  assert.equal(messageCreates.length, 0);
});

test("a contact removal is ignored and an add never counts as a sighting", async () => {
  const { store, contactUpserts } = fake();

  const applied = await store.absorbContacts(account, [
    {
      phoneNumberId: "pn-1",
      phone: "919900000000",
      bsuid: "IN.1",
      fullName: "Ravi Kumar",
      firstName: "Ravi",
      action: "remove",
    },
    {
      phoneNumberId: "pn-1",
      phone: "919900000001",
      bsuid: "IN.2",
      fullName: null,
      firstName: "Asha",
      action: "add",
    },
  ]);

  assert.equal(applied, 1);
  assert.equal(contactUpserts.length, 1);
  assert.equal("lastSeenAt" in contactUpserts[0], false);
  assert.equal(contactUpserts[0].profileName, "Asha");
});

test("a finished or declined sync is what the screen reads", async () => {
  const { store, accountUpdates } = fake();

  await store.noteComplete(account);
  await store.noteDeclined(account, "turned off");

  assert.ok(accountUpdates[0].historySyncDoneAt instanceof Date);
  assert.equal(accountUpdates[0].historySyncError, undefined);
  assert.equal(accountUpdates[1].historySyncError, "turned off");
});