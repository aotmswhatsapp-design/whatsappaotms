import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaService } from "../prisma/prisma.service";
import { contactFor } from "./contact.identity";

/**
 * One identity rule, two writers. In B1 a phone number is the only handle; the
 * two cases that matter are the message that names none (skipped, never keyed
 * on an empty string) and a phone-book entry, which is not a sighting.
 */

const account = { id: "acct-1", workspaceId: "ws-1", phoneNumberId: "pn-1" };

const at = new Date("2026-11-27T10:00:00Z");

function fake() {
  const upserts: {
    where: unknown;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }[] = [];

  const prisma = {
    contact: {
      upsert: async (args: {
        where: unknown;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        upserts.push(args);
        return { id: "contact-1" };
      },
    },
  } as unknown as PrismaService;

  return { prisma, upserts };
}

test("a message with no handle resolves to nothing, without a write", async () => {
  const { prisma, upserts } = fake();

  const contact = await contactFor(
    prisma,
    account,
    { phone: null, bsuid: null },
    null,
    at,
  );

  assert.equal(contact, null);
  assert.equal(upserts.length, 0);
});

test("a phone is keyed on the workspace and records the sighting", async () => {
  const { prisma, upserts } = fake();

  const contact = await contactFor(
    prisma,
    account,
    { phone: "919900000000", bsuid: null },
    "Ravi",
    at,
  );

  assert.deepEqual(contact, { id: "contact-1" });
  assert.deepEqual(upserts[0].where, {
    workspaceId_waId: { workspaceId: "ws-1", waId: "919900000000" },
  });
  assert.equal(upserts[0].create.lastSeenAt, at);
  assert.equal(upserts[0].update.lastSeenAt, at);
  assert.equal(upserts[0].update.profileName, "Ravi");
});

test("a phone-book entry is not a sighting, so it moves no timestamp", async () => {
  const { prisma, upserts } = fake();
  const original = new Date("2026-01-01T00:00:00Z");

  await contactFor(
    prisma,
    account,
    { phone: "919900000000", bsuid: null },
    "Bought list",
    null,
  );

  assert.equal("lastSeenAt" in upserts[0].create, false);
  assert.equal("lastSeenAt" in upserts[0].update, false);
  assert.notEqual(upserts[0].create.lastSeenAt, original);
});