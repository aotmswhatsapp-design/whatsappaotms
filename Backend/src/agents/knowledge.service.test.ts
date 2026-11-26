import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ConflictException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";

import { KnowledgeService } from "./knowledge.service";
import {
  CLAIMS,
  FakePrisma,
  FakeStorage,
  FakeWorkspaces,
  knowledgeConfig,
} from "./testing/fakes";

const build = (workspaceId = "ws-a", maxBytes?: number) => {
  const prisma = new FakePrisma();
  const storage = new FakeStorage();
  const service = new KnowledgeService(
    prisma as any,
    new FakeWorkspaces(workspaceId) as any,
    storage as any,
    knowledgeConfig({ KNOWLEDGE_MAX_BYTES: maxBytes }) as any,
  );
  return { prisma, storage, service };
};

const PDF = {
  buffer: Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF"),
  originalname: "prices.pdf",
  mimetype: "application/pdf",
  size: 33,
};

// 1×1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("a valid PDF is stored under the workspace-scoped path, with its hash", async () => {
  const { prisma, service } = build();
  const created: any[] = [];
  (prisma.knowledgeSource as any).create = async ({ data }: any) => {
    created.push(data);
    return {
      error: null,
      charCount: 0,
      chunkCount: 0,
      indexedAt: null,
      meta: null,
      replacesSourceId: null,
      createdAt: new Date(0),
      ...data,
    };
  };

  const { source } = await service.addFile(CLAIMS, "agent-1", PDF as any);

  assert.match(
    created[0].storagePath,
    /^workspaces\/ws-a\/agents\/agent-1\/knowledge\/[0-9a-f-]{36}\/original\.pdf$/,
  );
  assert.equal(created[0].sha256.length, 64);
  assert.equal(created[0].uploadedByUserId, "user-a");
  assert.equal(created[0].mime, "application/pdf");
  assert.equal(source.status, "PENDING");
});

test("an unsupported file never reaches storage", async () => {
  const { storage, service } = build();
  await assert.rejects(
    () =>
      service.addFile(CLAIMS, "agent-1", {
        buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        originalname: "backup.zip",
        mimetype: "application/zip",
        size: 4,
      } as any),
    /Upload a PDF/,
  );
  assert.equal(storage.uploaded.length, 0);
});

test("an exact duplicate is a 409 and stores nothing", async () => {
  const { prisma, storage, service } = build();
  (prisma.knowledgeSource as any).findFirst = async () => ({
    id: "old",
    title: "prices.pdf",
  });

  await assert.rejects(
    () => service.addFile(CLAIMS, "agent-1", PDF as any),
    (error: any) =>
      error instanceof ConflictException &&
      (error.getResponse() as { code?: string }).code === "SOURCE_DUPLICATE",
  );
  assert.equal(storage.uploaded.length, 0);
});

test("a race that slips past the lookup is still a 409, and only this attempt's object is removed", async () => {
  const { prisma, storage, service } = build();
  (prisma.knowledgeSource as any).create = async () => {
    throw Object.assign(new Error("unique"), { code: "P2002" });
  };

  await assert.rejects(
    () => service.addFile(CLAIMS, "agent-1", PDF as any),
    ConflictException,
  );

  // Not "a removal happened" but "this attempt's key was removed": a cleanup
  // that guessed a path, or reused an incumbent source's id, would fail here.
  assert.equal(storage.uploaded.length, 1);
  assert.equal(storage.removed.length, 1);
  assert.deepEqual(storage.removed[0], [storage.uploaded[0].path]);
  assert.match(
    storage.removed[0][0],
    /^workspaces\/ws-a\/agents\/agent-1\/knowledge\/[0-9a-f-]{36}\/original\.pdf$/,
  );
});

test("an oversized file is a 413 with SOURCE_TOO_LARGE", async () => {
  // The configured limit is lowered, so the service refuses before the
  // interceptor's own 25 MB ceiling is ever reached.
  const { storage, service } = build("ws-a", 8);

  await assert.rejects(
    () => service.addFile(CLAIMS, "agent-1", PDF as any),
    (error: any) =>
      error instanceof PayloadTooLargeException &&
      error.getStatus() === 413 &&
      (error.getResponse() as { code?: string }).code === "SOURCE_TOO_LARGE",
  );
  assert.equal(storage.uploaded.length, 0);
});

test("indexing a CSV writes one chunk per row range, with its sheet and its meta", async () => {
  const { prisma, storage, service } = build();
  const csv = ["item,price", ...Array.from({ length: 45 }, (_, at) => `item ${at + 1},${(at + 1) * 10}`)].join("\n");

  (prisma.knowledgeSource as any).findUnique = async () => ({
    id: "source-1",
    kind: "FILE",
    title: "prices.csv",
    mime: "text/csv",
    storagePath: "workspaces/ws-a/agents/agent-1/knowledge/source-1/original.csv",
    text: null,
    meta: null,
    replacesSourceId: null,
    status: "PROCESSING",
    leaseToken: "tok-1",
  });
  (storage as any).download = async () => Buffer.from(csv);

  const chunks: any[] = [];
  (prisma.knowledgeChunk as any).createMany = async ({ data }: any) => {
    chunks.push(...data);
    return { count: data.length };
  };

  const writes: any[] = [];
  (prisma.knowledgeSource as any).updateMany = async ({ data }: any) => {
    writes.push(data);
    return { count: 1 };
  };

  await service.index("source-1", "tok-1");

  // The record range is what a citation quotes, so it has to survive the write.
  // Record 1 is the header, so the first data record is number 2.
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((chunk) => [chunk.rowFrom, chunk.rowTo]), [[2, 21], [22, 41], [42, 46]]);
  assert.ok(chunks.every((chunk) => chunk.sheet === "CSV"));
  assert.ok(chunks.every((chunk) => chunk.text.startsWith("Columns: item | price")));

  const ready = writes.find((data) => data.status === "READY");
  assert.deepEqual(ready?.meta, {
    kind: "table",
    sheets: [{ name: "CSV", headers: ["item", "price"], rowCount: 45 }],
  });
});

test("an image upload is refused before anything is stored", async () => {
  const { storage, service } = build();

  await assert.rejects(
    () =>
      service.addFile(CLAIMS, "agent-1", {
        buffer: PNG,
        originalname: "menu.png",
        mimetype: "image/png",
        size: PNG.length,
      } as any),
    (error: any) =>
      error instanceof UnsupportedMediaTypeException &&
      (error.getResponse() as { code?: string }).code === "SOURCE_UNSUPPORTED" &&
      /without an AI model/.test(
        (error.getResponse() as { message?: string }).message ?? "",
      ),
  );
  assert.equal(storage.uploaded.length, 0);
});

test("a queued image row is failed with a sentence, not read", async () => {
  const { prisma, storage, service } = build();

  // The row was queued before images were refused, so the upload gate never
  // saw it. It must fail with the same sentence rather than be read.
  (prisma.knowledgeSource as any).findUnique = async () => ({
    id: "source-1",
    agentId: "agent-1",
    kind: "FILE",
    title: "menu.png",
    mime: "image/png",
    storagePath: "workspaces/ws-a/agents/agent-1/knowledge/source-1/original.png",
    text: null,
    meta: { kind: "image", mime: "image/png", width: 1, height: 1 },
    replacesSourceId: null,
    status: "PROCESSING",
    leaseToken: "tok-1",
  });
  (storage as any).download = async () => PNG;

  let failed: any;
  (prisma.knowledgeSource as any).updateMany = async ({ data }: any) => {
    if (data.status === "FAILED") failed = data;
    return { count: 1 };
  };

  await service.index("source-1", "tok-1");

  assert.match(failed?.error ?? "", /needs an AI model/);
  assert.equal(
    prisma.calls.some((call) => call.path === "knowledgeChunk.createMany"),
    false,
    "a refused source never becomes chunks",
  );
});

test("a typed note reaches READY and writes no vectors", async () => {
  const { prisma, service } = build();

  (prisma.knowledgeSource as any).findUnique = async () => ({
    id: "source-1",
    agentId: "agent-1",
    kind: "TEXT",
    title: "menu",
    mime: null,
    storagePath: null,
    text: "Dosa 80. Idli 40. Filter coffee 30.",
    meta: null,
    replacesSourceId: null,
    status: "PROCESSING",
    leaseToken: "tok-1",
  });

  let ready: any;
  (prisma.knowledgeSource as any).updateMany = async ({ data }: any) => {
    if (data.status === "READY") ready = data;
    return { count: 1 };
  };

  await service.index("source-1", "tok-1");

  // Search reads the text itself, so a READY row with no vectors is complete —
  // and nothing is written through raw SQL.
  assert.equal(ready?.status, "READY");
  assert.equal(
    prisma.calls.some((call) => call.path === "$executeRaw"),
    false,
    "answering never embeds",
  );
});
