import assert from "node:assert/strict";
import { test } from "node:test";

import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

import type { AuthClaims } from "../auth/auth.types";
import type { SecretBox } from "../common/crypto/secret-box";
import type { PrismaService } from "../prisma/prisma.service";
import type { WorkspacesService } from "../workspaces/workspaces.service";
import type { EmbeddedSignupDto } from "./dto/embedded-signup.dto";
import type { MetaGraph } from "./meta-graph";
import { WhatsAppService } from "./whatsapp.service";

/**
 * A coexistence finish reports the business account and nothing else, so the
 * number has to come from the account. These tests pin both halves: the single
 * number is used, and a choice between several is refused rather than guessed.
 */

const claims = { id: "user-1", email: "one@test.dev" } as AuthClaims;

function service(owned: string[], isOnBizApp = false) {
  const written: Record<string, unknown>[] = [];

  const prisma = {
    whatsAppAccount: {
      findUnique: async () => null,
      count: async () => 0,
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
    service: new WhatsAppService(prisma, workspaces, meta, box, config),
    written,
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
