import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConfigService } from "@nestjs/config";

import type { AuthClaims } from "../auth/auth.types";
import type { SecretBox } from "../common/crypto/secret-box";
import type { PrismaService } from "../prisma/prisma.service";
import type { WorkspacesService } from "../workspaces/workspaces.service";
import type { CoexistenceStarter } from "./coexistence.starter";
import { defaultAccount } from "./default-account";
import type { MetaGraph } from "./meta-graph";
import { WhatsAppService } from "./whatsapp.service";

/**
 * Disconnect must stop the number, not the history.
 *
 * Deleting the account row cascades through `conversations`, so these tests pin
 * the replacement: the row stays, its credentials are erased, no reader is ever
 * handed it, and nothing is deleted.
 */

const claims = { id: "user-1", email: "one@test.dev" } as AuthClaims;

/** The constructor reads its URLs and app id once; nothing here connects. */
const config = { get: () => undefined } as unknown as ConfigService;

function service() {
  const lookups: Record<string, unknown>[] = [];
  const writes: Record<string, unknown>[] = [];

  const prisma = {
    whatsAppAccount: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        lookups.push(args.where);

        // The first lookup is the number being disconnected. The two that
        // follow belong to promotion, and find nothing, so the workspace ends
        // with no default rather than a disconnected one.
        return lookups.length === 1 ? { id: "acct-1" } : null;
      },
      updateMany: async (args: Record<string, unknown>) => {
        writes.push(args);
        return { count: 1 };
      },
      update: async (args: Record<string, unknown>) => {
        writes.push(args);
        return {};
      },
      deleteMany: async () => {
        throw new Error("disconnect must never delete the row its history hangs off");
      },
    },
  } as unknown as PrismaService;

  const workspaces = {
    primaryFor: async () => ({ userId: "user-1", workspaceId: "ws-1" }),
  } as unknown as WorkspacesService;

  return {
    service: new WhatsAppService(
      prisma,
      workspaces,
      {} as MetaGraph,
      {} as SecretBox,
      config,
      {} as CoexistenceStarter,
    ),
    lookups,
    writes,
  };
}

test("disconnecting keeps the row and erases only what can still act", async () => {
  const { service: whatsapp, writes } = service();

  assert.deepEqual(await whatsapp.disconnect(claims), { removed: true });

  assert.equal(writes.length, 1);
  const [write] = writes as [{ where: Record<string, unknown>; data: Record<string, unknown> }];

  assert.equal(write.where.id, "acct-1");
  assert.equal(write.where.workspaceId, "ws-1");
  assert.equal(write.data.status, "DISCONNECTED");
  assert.ok(write.data.disconnectedAt instanceof Date);
  assert.equal(write.data.accessTokenCipher, null);
  assert.equal(write.data.verifyTokenCipher, null);
  assert.equal(write.data.appSecretCipher, null);
  assert.equal(write.data.webhookVerifiedAt, null);
  assert.equal(write.data.isDefault, false);
  assert.match(String(write.data.failureReason), /history is kept/i);
});

test("the number promoted in its place is never a disconnected one", async () => {
  const { service: whatsapp, lookups } = service();

  await whatsapp.disconnect(claims);

  // Current default, then the oldest candidate: both must exclude the row that
  // was just disconnected, or the workspace would answer from a mute number.
  assert.deepEqual(lookups[1].status, { not: "DISCONNECTED" });
  assert.deepEqual(lookups[2].status, { not: "DISCONNECTED" });
});

test("no reader is answered with a disconnected row", async () => {
  let seen: Record<string, unknown> | undefined;

  const prisma = {
    whatsAppAccount: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        seen = args.where;
        return null;
      },
    },
  } as unknown as PrismaService;

  await defaultAccount(prisma, "ws-1", { id: true });

  assert.deepEqual(seen, {
    workspaceId: "ws-1",
    status: { not: "DISCONNECTED" },
  });
});

test("a workspace with nothing connected reports nothing removed", async () => {
  const prisma = {
    whatsAppAccount: {
      findFirst: async () => null,
      updateMany: async () => {
        throw new Error("nothing was connected, so nothing may be written");
      },
    },
  } as unknown as PrismaService;

  const workspaces = {
    primaryFor: async () => ({ userId: "user-1", workspaceId: "ws-1" }),
  } as unknown as WorkspacesService;

  const whatsapp = new WhatsAppService(
    prisma,
    workspaces,
    {} as MetaGraph,
    {} as SecretBox,
    config,
    {} as CoexistenceStarter,
  );

  assert.deepEqual(await whatsapp.disconnect(claims), { removed: false });
});