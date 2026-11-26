import assert from "node:assert/strict";
import { test } from "node:test";

import {
  KnowledgeService,
  LEASE_RENEW_MS,
  STALE_MS,
  staleCutMs,
} from "./knowledge.service";
import {
  FakePrisma,
  FakeStorage,
  FakeWorkspaces,
  knowledgeConfig,
} from "./testing/fakes";

const build = (config: Record<string, unknown> = {}) => {
  const prisma = new FakePrisma();
  const storage = new FakeStorage();
  const service = new KnowledgeService(
    prisma as any,
    new FakeWorkspaces() as any,
    storage as any,
    knowledgeConfig(config) as any,
  );
  return { prisma, storage, service };
};

/** The row `loadForIndex` reads: claimed, and its text already on the row. */
const claimed = (overrides: Record<string, unknown> = {}) => ({
  id: "src-1",
  agentId: "agent-1",
  kind: "TEXT",
  title: "note",
  mime: null,
  storagePath: null,
  text: "hello there",
  meta: null,
  replacesSourceId: null,
  status: "PROCESSING",
  attempts: 0,
  leaseToken: "tok",
  ...overrides,
});

test("the stale cut follows the budget, so a live job is never reaped mid-run", () => {
  // The default 8-minute budget against the old 10-minute cut.
  assert.equal(staleCutMs(8 * 60 * 1000), 8 * 60 * 1000 + LEASE_RENEW_MS * 2);
  assert.ok(staleCutMs(8 * 60 * 1000) > STALE_MS);

  // A budget shorter than the floor still recovers a dead worker promptly.
  assert.equal(staleCutMs(60_000), STALE_MS);
});

test("recovery measures staleness against the derived cut", async () => {
  const { prisma, service } = build();
  (prisma.knowledgeSource as any).findMany = async () => [];

  const before = Date.now();
  await service.recoverStale();

  const requeue = prisma.calls.find(
    (call) => call.path === "knowledgeSource.updateMany",
  );
  const cut = (requeue?.args.where.updatedAt.lt as Date).getTime();

  assert.ok(cut >= before - staleCutMs(8 * 60 * 1000) - 1_000);
  assert.ok(cut <= Date.now() - staleCutMs(8 * 60 * 1000) + 1_000);
});

test("recovery hands the row on under a new epoch", async () => {
  const { prisma, service } = build();
  (prisma.knowledgeSource as any).findMany = async () => [];

  await service.recoverStale();

  const requeue = prisma.calls.find(
    (call) => call.path === "knowledgeSource.updateMany",
  );

  // Only a row whose lease stopped being renewed can match, and the increment
  // is what tells the previous worker it no longer holds the claim.
  assert.equal(requeue?.args.where.status, "PROCESSING");
  assert.equal(requeue?.args.where.updatedAt.lt instanceof Date, true);
  assert.deepEqual(requeue?.args.data, {
    status: "PENDING",
    attempts: { increment: 1 },
    leaseToken: null,
  });
});

test("a worker whose claim moved on writes no chunks and no status", async () => {
  const { prisma, service } = build();
  const seen: any[] = [];

  (prisma.knowledgeSource as any).findUnique = async () => claimed({ attempts: 3 });
  (prisma.knowledgeSource as any).updateMany = async (args: any) => {
    seen.push(args);
    return { count: 0 };
  };

  await service.index("src-1", "tok");

  // The guard is the first write, under the token the claim minted. `attempts`
  // is not part of it: a number can be reused, a token never is.
  assert.deepEqual(seen[0]?.where, {
    id: "src-1",
    status: "PROCESSING",
    leaseToken: "tok",
  });
  // Nothing followed it: no chunk write, no FAILED, no READY.
  assert.equal(seen.length, 1);

  assert.equal(
    prisma.calls.filter(
      (call) =>
        call.path === "knowledgeChunk.createMany" ||
        call.path === "knowledgeChunk.deleteMany",
    ).length,
    0,
  );
  assert.equal(
    prisma.calls.filter(
      (call) =>
        call.path === "knowledgeSource.updateMany" &&
        typeof call.args?.data?.status === "string",
    ).length,
    0,
  );
});

test("a failure after the claim moved on is not written over the owner's row", async () => {
  const { prisma, service } = build();
  (prisma.knowledgeSource as any).findUnique = async () => claimed({ attempts: 1 });

  // The renewal and the chunk write hold; the failure no longer does.
  let held = 0;
  (prisma.knowledgeSource as any).updateMany = async () => ({
    count: (held += 1) <= 2 ? 1 : 0,
  });
  // The read that follows the chunk write is where this attempt loses the row.
  (prisma.knowledgeChunk as any).findMany = async () => {
    throw new Error("chunk read down");
  };

  await service.index("src-1", "tok");

  const writes = prisma.calls.filter(
    (call) => call.path === "knowledgeSource.updateMany",
  );
  assert.equal(writes.some((call) => call.args.data?.status === "FAILED"), false);

  // Only the chunk replacement deleted anything; the newer attempt's chunks
  // were left alone.
  assert.equal(
    prisma.calls.filter((call) => call.path === "knowledgeChunk.deleteMany")
      .length,
    1,
  );
});

test("a failure is recorded under the epoch it was claimed with", async () => {
  const { prisma, storage, service } = build();

  (prisma.knowledgeSource as any).findUnique = async () =>
    claimed({
      kind: "FILE",
      title: "prices.csv",
      mime: "text/csv",
      storagePath: "workspaces/ws-a/agents/agent-1/knowledge/src-1/original.csv",
      text: null,
      attempts: 0,
    });
  (storage as any).download = async () => Buffer.from("item,price\nrice,449\n");

  // The chunk write is where this attempt loses: the failure must be recorded
  // under the claim's own token, so a newer owner's status still stands.
  prisma.refuse("knowledgeChunk.createMany");

  await service.index("src-1", "tok");

  const failed = prisma.calls.find(
    (call) =>
      call.path === "knowledgeSource.updateMany" &&
      call.args.data?.status === "FAILED",
  );

  assert.deepEqual(failed?.args.where, {
    id: "src-1",
    status: "PROCESSING",
    leaseToken: "tok",
  });
  assert.equal(failed?.args.data.chunkCount, 0);
  assert.equal(failed?.args.data.leaseToken, null);
});
