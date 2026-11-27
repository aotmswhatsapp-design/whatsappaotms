import assert from "node:assert/strict";
import { test } from "node:test";

import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

import type { AuthClaims } from "../auth/auth.types";
import type { SecretBox } from "../common/crypto/secret-box";
import type { PrismaService } from "../prisma/prisma.service";
import type { WorkspacesService } from "../workspaces/workspaces.service";
import type { CoexistenceStarter } from "./coexistence.starter";
import type { EmbeddedSignupDto } from "./dto/embedded-signup.dto";
import type { MetaGraph } from "./meta-graph";
import { WhatsAppService } from "./whatsapp.service";

/**
 * A coexistence finish reports the business account and nothing else, so the
 * number has to come from the account. These tests pin both halves: the single
 * number is used, and a choice between several is refused rather than guessed.
 */

const claims = { id: "user-1", email: "one@test.dev" } as AuthClaims;

function service(
  owned: string[],
  isOnBizApp = false,
  previous: Record<string, unknown> | null = null,
) {
  const written: Record<string, unknown>[] = [];
  const started: { onBizApp: boolean }[] = [];

  const prisma = {
    whatsAppAccount: {
      findUnique: async () =>
        previous
          ? {
              workspaceId: "ws-1",
              appId: "app-1",
              verifyTokenCipher: "sealed:old-token",
              status: "VERIFIED",
              ...previous,
            }
          : null,
      count: async () => 0,
      // Promotion after the upsert: nothing else is connected, so it finds no
      // default and no candidate and leaves the row as written.
      findFirst: async () => null,
      upsert: async (args: { create: Record<string, unknown> }) => {
        written.push(args.create);
        return {
          label: null,
          isDefault: true,
          appId: "app-1",
          source: "EMBEDDED_SIGNUP",
          tokenExpiresAt: null,
          lastVerifiedAt: new Date(),
          lastCheckAt: new Date(),
          failureReason: null,
          appSecretCipher: null,
          webhookVerifiedAt: new Date(),
          lastEventAt: null,
          eventCount: 0,
          ...args.create,
        };
      },
    },
  } as unknown as PrismaService;

  const meta = {
    exchangeCode: async () => "token-1",
    listBusinessPhoneNumberIds: async () => owned,
    getPhoneNumber: async () => ({
      id: owned[0],
      display_phone_number: "+91 98000 00000",
      verified_name: "Dosa",
      is_on_biz_app: isOnBizApp,
    }),
    getBusinessAccount: async () => ({ id: "102290129340398", name: "Dosa" }),
    subscribeApp: async () => undefined,
    debugToken: async () => ({ isValid: true, expiresAt: 1_800_000_000 }),
  } as unknown as MetaGraph;

  const config = {
    get: (key: string) =>
      ({
        META_APP_ID: "app-1",
        META_APP_SECRET: "secret-1",
        META_ES_CONFIG_ID: "cfg-1",
      })[key],
  } as unknown as ConfigService;

  const box = {
    seal: (value: string) => `sealed:${value}`,
    open: (value: string) => value.replace("sealed:", ""),
    hint: (value: string) => `••${value.slice(-4)}`,
  } as unknown as SecretBox;

  const workspaces = {
    primaryFor: async () => ({ userId: "user-1", workspaceId: "ws-1" }),
  } as unknown as WorkspacesService;

  return {
    service: new WhatsAppService(prisma, workspaces, meta, box, config, {
      begin: async (row: { onBizApp: boolean }) => {
        started.push(row);
      },
    } as unknown as CoexistenceStarter),
    written,
    started,
  };
}

const wabaOnly = {
  code: "0123456789abcdef",
  wabaId: "102290129340398",
} as EmbeddedSignupDto;

test("a finish that names only the account connects its one number", async () => {
  const { service: whatsapp, written } = service(["109800000000000"]);

  const result = await whatsapp.connectEmbedded(claims, wabaOnly);

  assert.equal(written[0].phoneNumberId, "109800000000000");
  assert.equal(written[0].businessAccountId, "102290129340398");
  assert.match(result.summary, /Connected/);
});

test("a number that stays in the business app is reported as shared", async () => {
  const { service: whatsapp } = service(["109800000000000"], true);

  const result = await whatsapp.connectEmbedded(claims, wabaOnly);

  assert.match(result.summary, /WhatsApp Business app/);
});

test("a number that stays in the business app has the sync asked for", async () => {
  const { service: whatsapp, written, started } = service(
    ["109800000000000"],
    true,
  );

  await whatsapp.connectEmbedded(claims, wabaOnly);

  assert.equal(written[0].onBizApp, true);
  assert.equal(started.length, 1);
  assert.equal(started[0].onBizApp, true);
});

test("a plain cloud number is never asked for business-app data", async () => {
  const { service: whatsapp, started } = service(["109800000000000"], false);

  await whatsapp.connectEmbedded(claims, wabaOnly);

  // `begin` is still called: it is the one place that decides, so the rule
  // cannot drift between the caller and the starter.
  assert.equal(started.length, 1);
  assert.equal(started[0].onBizApp, false);
});

test("an account with several numbers is refused, not guessed", async () => {
  const { service: whatsapp, written } = service([
    "109800000000000",
    "109800000000001",
  ]);

  await assert.rejects(
    () => whatsapp.connectEmbedded(claims, wabaOnly),
    BadRequestException,
  );

  assert.equal(written.length, 0);
});

test("reconnecting a disconnected number clears the mark and re-asks the sync", async () => {
  const { service: whatsapp, written } = service(["109800000000000"], true, {
    status: "DISCONNECTED",
    verifyTokenCipher: null,
  });

  await whatsapp.connectEmbedded(claims, wabaOnly);

  // The mark disconnect left must go, or the screen keeps calling a live number
  // disconnected.
  assert.equal(written[0].disconnectedAt, null);

  // Meta re-grants both kinds on a new onboarding, so the stale stamps have to
  // go too: their presence is what says "already asked for".
  assert.equal(written[0].stateSyncAt, null);
  assert.equal(written[0].historySyncAt, null);
  assert.equal(written[0].historySyncDoneAt, null);
});

test("rotating a live number's token leaves its sync stamps alone", async () => {
  const { service: whatsapp, written } = service(["109800000000000"], true);

  await whatsapp.connectEmbedded(claims, wabaOnly);

  // This row was never disconnected, so the sync it already asked for is not
  // asked for again — a second request is not legal.
  assert.equal(written[0].disconnectedAt, null);
  assert.equal("historySyncAt" in written[0], false);
  assert.equal("stateSyncAt" in written[0], false);
});
