import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import type { ConfigService } from "@nestjs/config";

import type { ReplyIntake } from "../agents/reply.intake";
import type { SecretBox } from "../common/crypto/secret-box";
import type { LeadIntake } from "../crm/lead.intake";
import type { HistoryStore } from "../inbox/history.store";
import type { InboxStore } from "../inbox/inbox.store";
import type { PrismaService } from "../prisma/prisma.service";
import type { CoexistenceStarter } from "./coexistence.starter";
import type { HistoryThread, MediaAsset, SyncedContact } from "./coexistence";
import { WhatsAppWebhookService } from "./whatsapp-webhook.service";

/**
 * A coexistence delivery must reach the history store and nothing else: an
 * imported message that reached `ReplyIntake` would be answered by a bot, and
 * one that reached `LeadIntake` would rewrite a lead's stage from 180-day-old
 * words. Both are asserted as "was not called".
 */

const SECRET = "platform-secret";

const account = {
  id: "acct-1",
  workspaceId: "ws-1",
  phoneNumberId: "pn-1",
  businessAccountId: "102290129340398",
  displayPhoneNumber: "+1 650 555 1234",
  appSecretCipher: null,
  status: "VERIFIED",
};

function signed(payload: unknown): [raw: Buffer, signature: string] {
  const raw = Buffer.from(JSON.stringify(payload));
  const digest = createHmac("sha256", SECRET).update(raw).digest("hex");

  return [raw, `sha256=${digest}`];
}

function delivery(field: string, value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        time: 1739212624,
        changes: [{ field, value }],
      },
    ],
  };
}

function fake(row: Record<string, unknown> = account) {
  const imported: HistoryThread[][] = [];
  const absorbed: SyncedContact[][] = [];
  const attached: MediaAsset[] = [];
  const notes: string[] = [];
  const stored: unknown[] = [];
  const queued: unknown[] = [];
  const classified: unknown[] = [];
  const accountUpdates: Record<string, unknown>[] = [];

  const history = {
    import: async (_account: unknown, threads: HistoryThread[]) => {
      imported.push(threads);
      return { written: 1, skipped: 0 };
    },
    absorbContacts: async (_account: unknown, contacts: SyncedContact[]) => {
      absorbed.push(contacts);
      return contacts.length;
    },
    attachMedia: async (_account: unknown, asset: MediaAsset) => {
      attached.push(asset);
    },
    noteComplete: async () => {
      notes.push("complete");
    },
    noteDeclined: async (_account: unknown, sentence: string) => {
      notes.push(sentence);
    },
  } as unknown as HistoryStore;

  const prisma = {
    whatsAppAccount: {
      findMany: async () => [row],
      update: async (args: { data: Record<string, unknown> }) => {
        accountUpdates.push(args.data);
        return account;
      },
    },
    messageTemplate: { updateMany: async () => ({ count: 0 }) },
  } as unknown as PrismaService;

  const config = {
    get: (key: string) => (key === "META_APP_SECRET" ? SECRET : undefined),
  } as unknown as ConfigService;

  const webhook = new WhatsAppWebhookService(
    prisma,
    { open: (value: string) => value } as unknown as SecretBox,
    config,
    {
      record: async (_account: unknown, changes: unknown[]) => {
        stored.push(changes);
        return [];
      },
    } as unknown as InboxStore,
    {
      enqueue: async (...args: unknown[]) => {
        queued.push(args);
      },
    } as unknown as ReplyIntake,
    {
      consider: async (...args: unknown[]) => {
        classified.push(args);
      },
    } as unknown as LeadIntake,
    history,
    { begin: async () => undefined } as unknown as CoexistenceStarter,
  );

  return {
    webhook,
    imported,
    absorbed,
    attached,
    notes,
    stored,
    queued,
    classified,
    accountUpdates,
  };
}

test("a history chunk is imported and still counts as a delivery", async () => {
  const { webhook, imported, stored, queued, classified, accountUpdates } = fake();

  await webhook.delivery(
    ...signed(
      delivery("history", {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "16505551234", phone_number_id: "pn-1" },
        history: [
          {
            metadata: { phase: 0, chunk_order: 1, progress: 100 },
            threads: [
              {
                id: "919900000000",
                messages: [
                  {
                    from: "919900000000",
                    from_user_id: "IN.1",
                    id: "wamid.in",
                    timestamp: "1739212624",
                    type: "text",
                    text: { body: "Two dosas" },
                    history_context: { status: "delivered" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    ),
  );

  assert.equal(imported.length, 1);
  assert.equal(imported[0][0].phone, "919900000000");
  // The stamp the sidebar's "last delivery" reads must move for history too.
  assert.ok(accountUpdates[0].lastEventAt instanceof Date);
  // A history change is not a live message: nothing enters the inbox path.
  assert.equal(stored.length, 0);
  assert.equal(queued.length, 0);
  assert.equal(classified.length, 0);
});

test("progress 100 marks the sync done", async () => {
  const { webhook, notes } = fake();

  await webhook.delivery(
    ...signed(
      delivery("history", {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "pn-1" },
        history: [{ metadata: { phase: 2, chunk_order: 9, progress: 100 }, threads: [] }],
      }),
    ),
  );

  assert.deepEqual(notes, ["complete"]);
});

test("the address book reaches the sync store, not the inbox", async () => {
  const { webhook, absorbed, stored } = fake();

  await webhook.delivery(
    ...signed(
      delivery("smb_app_state_sync", {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "pn-1" },
        state_sync: [
          {
            type: "contact",
            action: "add",
            metadata: { timestamp: "1739212624" },
            contact: { full_name: "Ravi Kumar", phone_number: "919900000000" },
          },
        ],
      }),
    ),
  );

  assert.equal(absorbed.length, 1);
  assert.equal(absorbed[0][0].fullName, "Ravi Kumar");
  assert.equal(stored.length, 0);
});

test("the declined history names its number without an entry wrapper", async () => {
  const { webhook, notes } = fake();

  await webhook.delivery(
    ...signed({
      messaging_product: "whatsapp",
      metadata: { phone_number_id: "pn-1" },
      history: [
        {
          errors: [
            {
              code: 2593109,
              title:
                "History sync is turned off by the business from the WhatsApp Business app",
            },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(notes, [
    "History sync is turned off by the business from the WhatsApp Business app",
  ]);
});

test("a media asset fills the placeholder it names", async () => {
  const { webhook, attached } = fake();
  await webhook.delivery(
    ...signed(
      delivery("history", {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "pn-1" },
        messages: [
          {
            from: "919900000000",
            id: "wamid.media",
            timestamp: "1739212624",
            type: "image",
            image: { id: "media-1", mime_type: "image/jpeg", sha256: "abc" },
          },
        ],
      }),
    ),
  );

  assert.equal(attached.length, 1);
  assert.equal(attached[0].wamid, "wamid.media");
  assert.equal(attached[0].kind, "IMAGE");
});

test("a delivery for a disconnected number is ignored, not stored", async () => {
  const { webhook, imported, stored, accountUpdates } = fake({
    ...account,
    status: "DISCONNECTED",
  });

  await webhook.delivery(
    ...signed(
      delivery("history", {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "pn-1" },
        history: [
          {
            metadata: { phase: 0, chunk_order: 1, progress: 100 },
            threads: [
              {
                id: "919900000000",
                messages: [
                  {
                    from: "919900000000",
                    id: "wamid.after-disconnect",
                    timestamp: "1739212624",
                    type: "text",
                    text: { body: "Are you open?" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    ),
  );

  // The row has no token, so nothing it receives can be trusted. Even the
  // delivery stamp stays put, which is what keeps the connection screen honest.
  assert.equal(imported.length, 0);
  assert.equal(stored.length, 0);
  assert.equal(accountUpdates.length, 0);
});