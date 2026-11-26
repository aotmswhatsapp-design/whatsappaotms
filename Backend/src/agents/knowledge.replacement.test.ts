import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import { KnowledgeService } from "./knowledge.service";
import {
  CLAIMS,
  FakePrisma,
  FakeProvider,
  FakeStorage,
  FakeWorkspaces,
  searchConfig,
} from "./testing/fakes";

const build = () => {
  const prisma = new FakePrisma();
  const storage = new FakeStorage();
  const service = new KnowledgeService(
    prisma as any,
    new FakeWorkspaces() as any,
    storage as any,
    new FakeProvider() as any,
    {} as any,
    searchConfig() as any,
  );
  return { prisma, storage, service };
};

/** The working source the replacement targets. */
const incumbent = () => ({
  id: "old",
  kind: "FILE",
  status: "READY",
  sha256: "oldhash",
  storagePath: "workspaces/ws-a/agents/agent-1/knowledge/old/original.pdf",
  title: "old.pdf",
});

/** Every column `sourceView` reads, for the "the row landed anyway" case. */
const landed = () => ({
  id: "fresh",
  kind: "FILE",
  title: "new.pdf",
  mime: "application/pdf",
  size: 12,
  storagePath: "workspaces/ws-a/agents/agent-1/knowledge/fresh/original.pdf",
  text: null,
  status: "PENDING",
  error: null,
  charCount: 0,
  chunkCount: 0,
  embedTokens: 0,
  attemptTokens: 0,
  extractTokens: 0,
  attempts: 0,
  indexedAt: null,
  sha256: "newhash",
  replacesSourceId: "old",
  meta: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const upload = () => ({
  buffer: Buffer.from("%PDF-1.7\nnew"),
  originalname: "new.pdf",
  mimetype: "application/pdf",
  size: 12,
});

/** `sourceOf` finds the incumbent; the duplicate lookup finds nothing. */
const wire = (prisma: FakePrisma) => {
  (prisma.knowledgeSource as any).findFirst = async (args: any) =>
    args.where.id === "old" ? incumbent() : null;
  // Read again under the lock, then looked for by the fresh id after a failure.
  (prisma.knowledgeSource as any).findUnique = async (args: any) =>
    args.where.id === "old" ? { status: "READY", sha256: "oldhash" } : null;
};

const rejectsWith = (code: string) => (error: any) =>
  error instanceof ConflictException &&
  (error.getResponse() as { code?: string }).code === code;

test("a second replacement is refused while a successor is still live", async () => {
  const { prisma, storage, service } = build();
  wire(prisma);
  // The incumbent is free, but a successor is already pending or being read.
  (prisma.knowledgeSource as any).count = async () => 1;

  await assert.rejects(
    () => service.replace(CLAIMS, "agent-1", "old", upload() as any),
    rejectsWith("SOURCE_BUSY"),
  );

  // No second row was written, and the incumbent's bytes were never touched:
  // only this attempt's own object went away.
  assert.equal(
    prisma.calls.filter((call) => call.path === "knowledgeSource.create").length,
    0,
  );
  assert.equal(storage.removed.length, 1);
  assert.deepEqual(storage.removed[0], [storage.uploaded[0].path]);
  assert.notEqual(storage.removed[0][0], incumbent().storagePath);
});

test("the successor count and the write share one ReadCommitted transaction", async () => {
  const { prisma, service } = build();
  wire(prisma);

  await service.replace(CLAIMS, "agent-1", "old", upload() as any);

  const transaction = prisma.calls.find((call) => call.path === "$transaction");
  assert.deepEqual(transaction?.args, {
    isolationLevel: "ReadCommitted",
    maxWait: 5000,
    timeout: 10000,
  });

  // The count that refuses the second replacement runs inside that transaction,
  // against the same agent, so two callers cannot both see zero.
  const counted = prisma.calls.find(
    (call) => call.path === "knowledgeSource.count",
  );
  assert.deepEqual(counted?.args.where, {
    agentId: "agent-1",
    replacesSourceId: "old",
    status: { in: ["PENDING", "PROCESSING", "READY"] },
  });
});

test("an expired transaction whose row landed keeps the object and reports success", async () => {
  const { prisma, storage, service } = build();
  wire(prisma);
  // The acknowledgement was lost, not the commit.
  (prisma as any).$transaction = async () => {
    throw Object.assign(new Error("Transaction API error"), { code: "P2028" });
  };
  (prisma.knowledgeSource as any).findUnique = async () => landed();

  const { source } = await service.replace(
    CLAIMS,
    "agent-1",
    "old",
    upload() as any,
  );

  assert.equal(source.id, "fresh");
  // The object is the one the committed row names: deleting it would break it.
  assert.deepEqual(storage.removed, []);
});

test("an expired transaction with no row is a retryable 503 and takes its own object", async () => {
  const { prisma, storage, service } = build();
  wire(prisma);
  (prisma as any).$transaction = async () => {
    throw Object.assign(new Error("Transaction API error"), { code: "P2028" });
  };

  await assert.rejects(
    () => service.replace(CLAIMS, "agent-1", "old", upload() as any),
    ServiceUnavailableException,
  );

  assert.equal(storage.removed.length, 1);
  assert.deepEqual(storage.removed[0], [storage.uploaded[0].path]);
});

test("a write-conflict victim is a 409 and takes only its own object", async () => {
  const { prisma, storage, service } = build();
  wire(prisma);
  (prisma as any).$transaction = async () => {
    throw Object.assign(new Error("write conflict"), { code: "P2034" });
  };

  await assert.rejects(
    () => service.replace(CLAIMS, "agent-1", "old", upload() as any),
    rejectsWith("SOURCE_BUSY"),
  );

  assert.equal(storage.removed.length, 1);
  assert.deepEqual(storage.removed[0], [storage.uploaded[0].path]);
});

test("when the write cannot be confirmed the object is kept, not deleted", async () => {
  const { prisma, storage, service } = build();
  wire(prisma);
  (prisma as any).$transaction = async () => {
    throw Object.assign(new Error("row refused"), { code: "P2002" });
  };
  (prisma.knowledgeSource as any).findUnique = async () => {
    throw new Error("database unavailable");
  };

  await assert.rejects(
    () => service.replace(CLAIMS, "agent-1", "old", upload() as any),
    // The database's own failure is reported, not swallowed into a guess.
    (error: any) => error.code === "P2002",
  );

  // Doubt resolves towards the bytes that might belong to a row.
  assert.deepEqual(storage.removed, []);
});

test("a predecessor that no longer exists is a 404 and leaves no orphan object", async () => {
  const { prisma, storage, service } = build();
  wire(prisma);
  (prisma.knowledgeSource as any).updateMany = async () => ({ count: 0 });

  await assert.rejects(
    () => service.replace(CLAIMS, "agent-1", "old", upload() as any),
    NotFoundException,
  );

  assert.equal(storage.removed.length, 1);
  assert.deepEqual(storage.removed[0], [storage.uploaded[0].path]);
});
