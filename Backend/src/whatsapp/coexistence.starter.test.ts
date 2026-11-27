import assert from "node:assert/strict";
import { test } from "node:test";

import type { SecretBox } from "../common/crypto/secret-box";
import type { PrismaService } from "../prisma/prisma.service";
import { CoexistenceStarter } from "./coexistence.starter";
import { MetaRequestError } from "./meta-graph";

/**
 * Each synchronisation may be performed once, ever. So the two things that
 * matter here are the order Meta documents and the rule that a timestamp is
 * written only after Meta accepted — a claimed-but-refused request would look
 * done forever.
 */

const account = {
  id: "acct-1",
  phoneNumberId: "pn-1",
  graphVersion: "v23.0",
  accessTokenCipher: "sealed:tok-1",
  onBizApp: true,
  stateSyncAt: null,
  historySyncAt: null,
};

function fake(
  options: { refusals?: Record<string, Error>; updateThrows?: boolean } = {},
) {
  const calls: { syncType: string; token: string }[] = [];
  const updates: Record<string, unknown>[] = [];

  const meta = {
    requestSmbAppData: async (input: { syncType: string; token: string }) => {
      calls.push({ syncType: input.syncType, token: input.token });

      const refusal = options.refusals?.[input.syncType];
      if (refusal) throw refusal;

      return { requestId: `req-${input.syncType}` };
    },
  };

  const prisma = {
    whatsAppAccount: {
      update: async (args: { data: Record<string, unknown> }) => {
        if (options.updateThrows) throw new Error("database is down");
        updates.push(args.data);
        return {};
      },
    },
  } as unknown as PrismaService;

  const box = {
    open: (value: string) => value.replace("sealed:", ""),
  } as unknown as SecretBox;

  return {
    starter: new CoexistenceStarter(prisma, meta as never, box),
    calls,
    updates,
  };
}

test("both requests go out, state first, with the documented ids", async () => {
  const { starter, calls, updates } = fake();

  await starter.begin(account);

  assert.deepEqual(
    calls.map((call) => call.syncType),
    ["smb_app_state_sync", "history"],
  );
  assert.equal(calls[0].token, "tok-1");
  assert.equal(updates[0].stateSyncRequestId, "req-smb_app_state_sync");
  assert.ok(updates[0].stateSyncAt instanceof Date);
  assert.equal(updates[1].historySyncRequestId, "req-history");
  assert.equal(updates[1].historySyncError, null);
});

test("a second run makes no call at all", async () => {
  const { starter, calls } = fake();

  await starter.begin({
    ...account,
    stateSyncAt: new Date(),
    historySyncAt: new Date(),
  });

  assert.equal(calls.length, 0);
});

test("a number that is not in the business app is never asked", async () => {
  const { starter, calls } = fake();

  await starter.begin({ ...account, onBizApp: false });

  assert.equal(calls.length, 0);
});

test("a refused history records the sentence and leaves the stamp null", async () => {
  const refusal = new MetaRequestError(400, {
    message: "Invalid parameter",
    error_data: {
      details: "This phone number is not eligible for history sync.",
    },
  });
  const { starter, updates } = fake({ refusals: { history: refusal } });

  await starter.begin(account);

  assert.equal(updates[0].stateSyncAt instanceof Date, true);
  assert.equal("historySyncAt" in updates[1], false);
  assert.match(String(updates[1].historySyncError), /not eligible/);
});

test("a refused state sync still asks for the history", async () => {
  const { starter, calls } = fake({
    refusals: {
      smb_app_state_sync: new MetaRequestError(500, { message: "Unknown error" }),
    },
  });

  await starter.begin(account);

  assert.deepEqual(
    calls.map((call) => call.syncType),
    ["smb_app_state_sync", "history"],
  );
});

test("an undecryptable token is a recorded reason, not a crash", async () => {
  const prisma = {
    whatsAppAccount: {
      update: async (args: { data: Record<string, unknown> }) => {
        assert.match(String(args.data.historySyncError), /decrypted/);
        return {};
      },
    },
  } as unknown as PrismaService;

  const starter = new CoexistenceStarter(
    prisma,
    { requestSmbAppData: async () => ({ requestId: null }) } as never,
    {
      open: () => {
        throw new Error("bad key");
      },
    } as unknown as SecretBox,
  );

  await starter.begin(account);
});

test("a database that is down does not throw into the webhook", async () => {
  const { starter } = fake({ updateThrows: true });

  await starter.begin(account);
});