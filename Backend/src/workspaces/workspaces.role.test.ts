import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictException } from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import { WorkspacesService } from "./workspaces.service";

/**
 * A second owner is granted here, so the two seats that must not move are
 * worth pinning down: the account the workspace was created with, and the
 * caller's own.
 */
const CALLER = "11111111-1111-1111-1111-111111111111";
const FOUNDER = "22222222-2222-2222-2222-222222222222";
const MEMBER = "33333333-3333-3333-3333-333333333333";

const claims = { id: CALLER, email: "owner@buildmarque.test" } as unknown as AuthClaims;

function harness(ownerId = FOUNDER) {
  const written: { role?: string }[] = [];

  const prisma = {
    workspaceMember: {
      findFirst: async () => ({ workspaceId: "ws-1", role: "OWNER" }),
      updateMany: async (input: { data: { role: string } }) => {
        written.push(input.data);
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({
        userId: MEMBER,
        // The row as a real read would find it: whatever the update stored.
        role: written.at(-1)?.role ?? "AGENT",
        designation: null,
        personalWhatsApp: null,
        user: { fullName: "Second Owner", email: "second@buildmarque.test", avatarUrl: null },
      }),
    },
    workspace: {
      findUniqueOrThrow: async () => ({ ownerId }),
    },
  };

  const users = { syncFromClaims: async () => ({ id: CALLER }) };

  return {
    service: new WorkspacesService(prisma as unknown as never, users as unknown as never),
    written,
  };
}

async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(
    () => null,
    (error: unknown) => error,
  );
}

test("the account that created the workspace keeps its role", async () => {
  const { service, written } = harness();

  const error = await refusal(() => service.changeRole(claims, FOUNDER, "ADMIN"));

  assert.ok(error instanceof ConflictException);
  assert.equal((error.getResponse() as { code: string }).code, "OWNER_IMMUTABLE");
  assert.deepEqual(written, []);
});

test("an owner cannot change their own role", async () => {
  const { service, written } = harness();

  const error = await refusal(() => service.changeRole(claims, CALLER, "AGENT"));

  assert.ok(error instanceof ConflictException);
  assert.equal((error.getResponse() as { code: string }).code, "SELF_ROLE");
  assert.deepEqual(written, []);
});

test("a member can be made a second owner", async () => {
  const { service, written } = harness();

  const { member } = await service.changeRole(claims, MEMBER, "OWNER");

  assert.deepEqual(written, [{ role: "OWNER" }]);
  assert.equal(member.role, "OWNER");
  // Only the account the workspace was created with carries the protected seat.
  assert.equal(member.owner, false);
});