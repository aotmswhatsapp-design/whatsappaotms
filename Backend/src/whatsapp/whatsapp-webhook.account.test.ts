import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConfigService } from "@nestjs/config";

import type { ReplyIntake } from "../agents/reply.intake";
import type { SecretBox } from "../common/crypto/secret-box";
import type { LeadIntake } from "../crm/lead.intake";
import type { HistoryStore } from "../inbox/history.store";
import type { InboxStore } from "../inbox/inbox.store";
import type { PrismaService } from "../prisma/prisma.service";
import type { CoexistenceStarter } from "./coexistence.starter";
import { WhatsAppWebhookService } from "./whatsapp-webhook.service";

/**
 * `account_update` is the one delivery the normal lookup cannot resolve, so
 * these tests read the `where` it queries with and the row it writes when the
 * lookup succeeds: a wrong id there is a disconnection nobody ever sees.
 */

const SECRET = "platform-secret";

const account = {
  id: "acct-1",
  workspaceId: "ws-1",
  phoneNumberId: "pn-1",
  businessAccountId: "102290129340398",
  appSecretCipher: null,
};

/** `delivery`'s two arguments, in the order the webhook takes them. */
function signed(payload: unknown): [raw: Buffer, signature: string] {
  const raw = Buffer.from(JSON.stringify(payload));
  const digest = createHmac("sha256", SECRET).update(raw).digest("hex");

  return [raw, `sha256=${digest}`];
}

function delivery(entryId: string, value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: entryId,
        time: 1739212624,
        changes: [{ field: "account_update", value }],
      },
    ],
  };
}

function fake() {
  const accountUpdates: { where: { id: string }; data: Record<string, unknown> }[] =
    [];
  const lookedUp: unknown[] = [];

  const prisma = {
    whatsAppAccount: {
      findMany: async (args: { where: unknown }) => {
        lookedUp.push(args.where);
        return [account];
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        accountUpdates.push(args);
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
    { record: async () => [] } as unknown as InboxStore,
    { enqueue: async () => undefined } as unknown as ReplyIntake,
    { consider: async () => undefined } as unknown as LeadIntake,
    {
      import: async () => ({ written: 0, skipped: 0 }),
      attachMedia: async () => undefined,
      absorbContacts: async () => 0,
      noteComplete: async () => undefined,
      noteDeclined: async () => undefined,
    } as unknown as HistoryStore,
    { begin: async () => undefined } as unknown as CoexistenceStarter,
  );

  return { webhook, accountUpdates, lookedUp };
}

test("the customer's account is found even though the entry names the partner", async () => {
  const { webhook, lookedUp } = fake();

  await webhook.delivery(
    ...signed(
      delivery("2949482758682047", {
        event: "PARTNER_REMOVED",
        waba_info: { waba_id: "102290129340398" },
        disconnection_info: { reason: "PRIMARY_INACTIVITY", initiated_by: "SYSTEM" },
      }),
    ),
  );

  const where = lookedUp[0] as {
    OR: {
      phoneNumberId?: { in: string[] };
      businessAccountId?: { in: string[] };
    }[];
  };

  assert.deepEqual(where.OR[0].phoneNumberId?.in, []);
  assert.ok(where.OR[1].businessAccountId?.in.includes("102290129340398"));
});

test("a disconnection marks the row unusable and says why", async () => {
  const { webhook, accountUpdates } = fake();

  await webhook.delivery(
    ...signed(
      delivery("2949482758682047", {
        event: "PARTNER_REMOVED",
        waba_info: { waba_id: "102290129340398" },
        disconnection_info: { reason: "PRIMARY_INACTIVITY", initiated_by: "SYSTEM" },
      }),
    ),
  );

  const marked = accountUpdates.find((call) => "status" in call.data);

  assert.ok(marked, "nothing was written to the row");
  assert.equal(marked.data.status, "FAILED");
  assert.match(String(marked.data.failureReason), /14 days/);
});

test("a reconnect clears the reason the screen was showing", async () => {
  const { webhook, accountUpdates } = fake();

  await webhook.delivery(
    ...signed(delivery("102290129340398", { event: "ACCOUNT_RECONNECTED" })),
  );

  const marked = accountUpdates.find((call) => "status" in call.data);

  assert.ok(marked);
  assert.equal(marked.data.status, "VERIFIED");
  assert.equal(marked.data.failureReason, null);
});

test("an unknown event on an account we cannot name writes nothing", async () => {
  // No `waba_info`: the entry id is the partner's, and must not be mistaken
  // for the customer's account just because a row matched the query.
  const { webhook, accountUpdates } = fake();

  await webhook.delivery(
    ...signed(delivery("2949482758682047", { event: "PARTNER_REMOVED" })),
  );

  assert.equal(accountUpdates.length, 0);
});
