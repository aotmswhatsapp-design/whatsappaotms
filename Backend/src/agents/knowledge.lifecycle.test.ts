import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictException } from "@nestjs/common";

import { sha256Of } from "./knowledge.file";
import { KnowledgeService } from "./knowledge.service";
import {
  CLAIMS,
  FakePrisma,
  FakeProvider,
  FakeStorage,
  FakeWorkspaces,
  searchConfig,
} from "./testing/fakes";

const build = (config: Record<string, unknown> = {}) => {
  const prisma = new FakePrisma();
  const storage = new FakeStorage();
  const service = new KnowledgeService(
    prisma as any,
    new FakeWorkspaces() as any,
    storage as any,
    new FakeProvider() as any,
    {} as any,
    searchConfig(config) as any,
  );
  return { prisma, storage, service };
};

/** The row `sourceOf` and the replacement's lock both read. */
const source = (status = "READY") => ({
  id: "old",
  kind: "FILE",
  status,
  sha256: "oldhash",
  storagePath: "workspaces/ws-a/agents/agent-1/knowledge/old/original.pdf",
  title: "old.pdf",
});

const upload = (body: string) => ({
  buffer: Buffer.from(body),
  originalname: "new.pdf",
  mimetype: "application/pdf",
  size: Buffer.byteLength(body),
});

const rejectsWith = (code: string) => (error: any) =>
  error instanceof ConflictException &&
  (error.getResponse() as { code?: string }).code === code;

test("retry of a PROCESSING source is a 409 and changes nothing", async () => {
  const { prisma, service } = build();
  (prisma.knowledgeSource as any).findFirst = async () => source("PROCESSING");
  // The lock finds the row; the conditional reset matches no status.
  (prisma.knowledgeSource as any).updateMany = async (args: any) => ({
    count: args.data?.status ? 0 : 1,
  });

  await assert.rejects(
    () => service.retry(CLAIMS, "agent-1", "old"),
    rejectsWith("SOURCE_BUSY"),
  );

  assert.equal(
    prisma.calls.filter((call) => call.path === "knowledgeSource.deleteMany").length,
    0,
  );
});

test("retry of a FAILED source resets every counter, conditionally", async () => {
  const { prisma, service } = build();
  (prisma.knowledgeSource as any).findFirst = async () => source("FAILED");

  const { source: row } = await service.retry(CLAIMS, "agent-1", "old");

  const write = prisma.calls.find(
    (call) =>
      call.path === "knowledgeSource.updateMany" &&
      call.args.data?.status === "PENDING",
  );

  // The guard is part of the write, not a check before it (B-2).
  assert.deepEqual(write?.args.where, {
    id: "old",
    agentId: "agent-1",
    status: { in: ["FAILED", "READY"] },
  });
  assert.equal(write?.args.data.chunkCount, 0);
  assert.equal(write?.args.data.charCount, 0);
  assert.equal(write?.args.data.embedTokens, 0);
  assert.equal(write?.args.data.extractTokens, 0);
  assert.equal(write?.args.data.attempts, 0);
  assert.equal(write?.args.data.text, null);
  assert.equal(row.status, "PENDING");
});

test("deleting a PROCESSING source is refused, and its bytes stay", async () => {
  const { prisma, storage, service } = build();
  (prisma.knowledgeSource as any).findFirst = async () => source("PROCESSING");
  (prisma.knowledgeSource as any).deleteMany = async () => ({ count: 0 });

  await assert.rejects(
    () => service.remove(CLAIMS, "agent-1", "old"),
    rejectsWith("SOURCE_BUSY"),
  );

  assert.deepEqual(storage.removed, []);
});

test("a replacement writes a new row and leaves the old one READY", async () => {
  const { prisma, storage, service } = build();
  const live = source("READY");
  const created: any[] = [];

  (prisma.knowledgeSource as any).findFirst = async (args: any) =>
    args.where.sha256 ? null : live;
  (prisma.knowledgeSource as any).findUnique = async (args: any) =>
    args.where.id === "old" ? live : null;

  const record = (prisma.knowledgeSource as any).create;
  (prisma.knowledgeSource as any).create = async (args: any) => {
    created.push(args.data);
    return record(args);
  };

  const { source: row } = await service.replace(
    CLAIMS,
    "agent-1",
    "old",
    upload("%PDF-1.7\nnew") as any,
  );

  assert.equal(created[0].replacesSourceId, "old");
  assert.equal(row.status, "PENDING");

  // The predecessor is the lock's subject, never a deletion.
  const lock = prisma.calls.find(
    (call) => call.path === "knowledgeSource.updateMany",
  );
  assert.deepEqual(lock?.args.where, { id: "old", agentId: "agent-1" });
  assert.equal(
    prisma.calls.filter((call) => call.path === "knowledgeSource.deleteMany").length,
    0,
  );
  assert.deepEqual(storage.removed, []);
});

test("replacing with the identical file is refused before anything is written", async () => {
  const { prisma, storage, service } = build();
  const bytes = Buffer.from("%PDF-1.7\nsame");

  (prisma.knowledgeSource as any).findFirst = async () => ({
    ...source("READY"),
    sha256: sha256Of(bytes),
  });

  await assert.rejects(
    () => service.replace(CLAIMS, "agent-1", "old", upload("%PDF-1.7\nsame") as any),
    rejectsWith("SOURCE_UNCHANGED"),
  );

  assert.deepEqual(storage.uploaded, []);
});

test("a failed replacement leaves the old source and its bytes untouched", async () => {
  const { prisma, storage, service } = build();
  const live = source("READY");

  (prisma.knowledgeSource as any).findFirst = async (args: any) =>
    args.where.sha256 ? null : live;
  (prisma.knowledgeSource as any).findUnique = async (args: any) =>
    args.where.id === "old" ? live : null;
  (prisma.knowledgeSource as any).create = async () => {
    throw new Error("row refused");
  };

  await assert.rejects(() =>
    service.replace(CLAIMS, "agent-1", "old", upload("%PDF-1.7\nnew") as any),
  );

  // Nothing touched the working source; only this attempt's own object was
  // cleaned up, and only its path.
  assert.equal(
    prisma.calls.filter((call) => call.path === "knowledgeSource.deleteMany").length,
    0,
  );
  assert.equal(storage.removed.length, 1);
  assert.equal(storage.removed[0].length, 1);
  assert.equal(storage.removed[0][0], storage.uploaded[0].path);
  assert.notEqual(storage.removed[0][0], live.storagePath);
});

test("a typed note cannot be replaced", async () => {
  const { prisma, service } = build();
  (prisma.knowledgeSource as any).findFirst = async () => ({
    ...source("READY"),
    kind: "TEXT",
    sha256: null,
    storagePath: null,
    title: "note",
  });

  await assert.rejects(
    () => service.replace(CLAIMS, "agent-1", "old", upload("%PDF-1.7") as any),
    rejectsWith("SOURCE_NOT_FILE"),
  );
});

/** The successor as `loadForIndex` sees it: claimed, with its text already read. */
const successor = (overrides: Record<string, unknown> = {}) => ({
  id: "new",
  agentId: "agent-1",
  kind: "FILE",
  title: "v2.pdf",
  mime: "application/pdf",
  storagePath: "workspaces/ws-a/agents/agent-1/knowledge/new/original.pdf",
  text: "the new price list",
  status: "PROCESSING",
  attempts: 0,
  leaseToken: "tok-new",
  meta: null,
  extractTokens: 0,
  replacesSourceId: "old",
  agent: { model: "gpt-4o-mini" },
  ...overrides,
});

test("becoming READY retires the predecessor in one transaction, then removes its object", async () => {
  const { prisma, storage, service } = build();
  const removedDuringTransaction: number[] = [];

  const transaction = prisma.$transaction;
  (prisma as any).$transaction = async (input: any) => {
    const result = await transaction(input);
    // Still open here: the object must outlive the commit, not the other way.
    removedDuringTransaction.push(storage.removed.length);
    return result;
  };

  (prisma.knowledgeSource as any).findUnique = async () => successor();
  (prisma.knowledgeSource as any).findFirst = async () => ({
    id: "old",
    storagePath: "workspaces/ws-a/agents/agent-1/knowledge/old/original.pdf",
  });

  // Recorded through the fake, then answered with a retirement that landed.
  const remove = (prisma.knowledgeSource as any).deleteMany;
  (prisma.knowledgeSource as any).deleteMany = async (args: any) => {
    await remove(args);
    return { count: 1 };
  };

  await service.index("new", "tok-new");

  const ready = prisma.calls.find(
    (call) =>
      call.path === "knowledgeSource.updateMany" &&
      call.args.data?.status === "READY",
  );
  assert.equal(ready?.args.where.status, "PROCESSING");
  // The token the claim minted is part of the write: a worker whose row was
  // requeued cannot mark it READY afterwards.
  assert.equal(ready?.args.where.leaseToken, "tok-new");

  // The retirement is conditional on the successor being READY, in the same
  // agent, inside the transaction that wrote it.
  const retired = prisma.calls.find(
    (call) => call.path === "knowledgeSource.deleteMany",
  );
  assert.deepEqual(retired?.args.where, {
    id: "old",
    agentId: "agent-1",
    // A row being read is never retired: that worker still owns its chunks.
    status: { not: "PROCESSING" },
    agent: { sources: { some: { id: "new", status: "READY" } } },
  });

  // No transaction that ran had already deleted the bytes: every one of them
  // settled before the object went, and the retirement's own transaction is
  // among them.
  assert.ok(removedDuringTransaction.length > 0);
  assert.ok(removedDuringTransaction.every((count) => count === 0));
  assert.deepEqual(storage.removed, [
    ["workspaces/ws-a/agents/agent-1/knowledge/old/original.pdf"],
  ]);
});

test("a retirement that loses the race removes no bytes", async () => {
  const { prisma, storage, service } = build();

  (prisma.knowledgeSource as any).findUnique = async () => successor();
  (prisma.knowledgeSource as any).findFirst = async () => ({
    id: "old",
    storagePath: "workspaces/ws-a/agents/agent-1/knowledge/old/original.pdf",
  });
  (prisma.knowledgeSource as any).deleteMany = async () => ({ count: 0 });

  await service.index("new", "tok-new");

  assert.deepEqual(storage.removed, []);
});

test("retry is refused while a replacement is being prepared", async () => {
  const { prisma, service } = build();
  (prisma.knowledgeSource as any).findFirst = async () => source("READY");
  // A successor exists, so the successor here is the live one.
  (prisma.knowledgeSource as any).count = async () => 1;

  await assert.rejects(
    () => service.retry(CLAIMS, "agent-1", "old"),
    rejectsWith("SOURCE_BUSY"),
  );

  // Nothing reset the row a READY successor is about to retire.
  assert.equal(
    prisma.calls.filter(
      (call) =>
        call.path === "knowledgeSource.updateMany" &&
        call.args.data?.status === "PENDING",
    ).length,
    0,
  );
});

test("retry takes the successor check under the replacement's own lock", async () => {
  const { prisma, service } = build();
  (prisma.knowledgeSource as any).findFirst = async () => source("FAILED");

  await service.retry(CLAIMS, "agent-1", "old");

  const counted = prisma.calls.find(
    (call) => call.path === "knowledgeSource.count",
  );
  assert.deepEqual(counted?.args.where, {
    agentId: "agent-1",
    replacesSourceId: "old",
    status: { in: ["PENDING", "PROCESSING", "READY"] },
  });

  // The lock is the first statement of the transaction, and the count runs
  // after it: a replacement created in between would block on the same lock.
  const lock = prisma.calls.find(
    (call) => call.path === "knowledgeSource.updateMany",
  );
  assert.deepEqual(lock?.args.where, { id: "old", agentId: "agent-1" });
  assert.ok(
    prisma.calls.indexOf(lock!) < prisma.calls.indexOf(counted!),
  );
});
