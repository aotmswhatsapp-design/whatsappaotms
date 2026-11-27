import assert from "node:assert/strict";
import { test } from "node:test";

import { ConflictException } from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import type { PrismaService } from "../prisma/prisma.service";
import type { TemplatePhoto } from "../templates/template-photo";
import type { WorkspacesService } from "../workspaces/workspaces.service";
import type { SendTextDto } from "./dto/send-text.dto";
import type { InboxSender } from "./inbox.sender";
import { InboxService } from "./inbox.service";
import type { MediaStorage } from "./media.storage";

/**
 * A disconnected number keeps its conversations readable, so an agent can still
 * open the thread. Sending is the one thing it cannot do, and the refusal has to
 * say why — a null token reaching the sender would only produce a decryption
 * error nobody can act on.
 */

const claims = { id: "user-1", email: "one@test.dev" } as AuthClaims;

function service(account: Record<string, unknown> | null) {
  const prisma = {
    conversation: {
      findFirst: async () => ({
        id: "chat-1",
        accountId: "acct-1",
        lastInboundAt: new Date(),
        contact: { waId: "919900000000" },
      }),
    },
    whatsAppAccount: {
      findFirst: async () => account,
    },
  } as unknown as PrismaService;

  const workspaces = {
    primaryFor: async () => ({
      workspaceId: "ws-1",
      userId: "user-1",
      role: "OWNER",
    }),
  } as unknown as WorkspacesService;

  return new InboxService(
    prisma,
    workspaces,
    {} as InboxSender,
    {} as MediaStorage,
    {} as TemplatePhoto,
  );
}

test("a disconnected number refuses to send and names the fix", async () => {
  const inbox = service({
    status: "DISCONNECTED",
    phoneNumberId: "pn-1",
    graphVersion: "v21.0",
    accessTokenCipher: null,
  });

  await assert.rejects(
    () => inbox.sendText(claims, "chat-1", { body: "Hello?" } as SendTextDto),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);

      const body = error.getResponse() as { code: string; message: string };

      assert.equal(body.code, "NO_CHANNEL");
      assert.match(body.message, /disconnected/);
      assert.match(body.message, /Reconnect/);

      return true;
    },
  );
});

test("a thread whose number is gone asks for a number, not for a reconnect", async () => {
  const inbox = service(null);

  await assert.rejects(
    () => inbox.sendText(claims, "chat-1", { body: "Hello?" } as SendTextDto),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);

      const body = error.getResponse() as { code: string; message: string };

      assert.equal(body.code, "NO_CHANNEL");
      assert.match(body.message, /Connect a WhatsApp number/);

      return true;
    },
  );
});