import assert from "node:assert/strict";
import { test } from "node:test";

import { ConflictException, PayloadTooLargeException } from "@nestjs/common";

import { KnowledgeService } from "./knowledge.service";
import { RetrievalService } from "./retrieval.service";
import {
  CLAIMS,
  FakePrisma,
  FakeProvider,
  FakeStorage,
  FakeWorkspaces,
} from "./testing/fakes";

const build = (workspaceId = "ws-a", maxBytes?: number, media: unknown = {}) => {
  const prisma = new FakePrisma();
  const storage = new FakeStorage();
  const service = new KnowledgeService(
    prisma as any,
    new FakeWorkspaces(workspaceId) as any,
    storage as any,
    new FakeProvider() as any,
    media as any,
    {
      get: (key: string) =>
        key === "KNOWLEDGE_MAX_BYTES" ? maxBytes : undefined,
    } as any,
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
      embedTokens: 0,
      extractTokens: 0,
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
    extractTokens: 0,
    replacesSourceId: null,
    status: "PROCESSING",
    leaseToken: "tok-1",
    agent: { model: "gpt-4o-mini" },
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
  assert.equal(ready?.extractTokens, 0);
});

test("an image upload records its own type and pixel size at upload", async () => {
  const { service } = build();

  const { source } = await service.addFile(CLAIMS, "agent-1", {
    buffer: PNG,
    originalname: "menu.png",
    mimetype: "image/png",
    size: PNG.length,
  } as any);

  assert.deepEqual(source.meta, {
    kind: "image",
    mime: "image/png",
    width: 1,
    height: 1,
  });
});

test("indexing an image puts the vision call's tokens on the row", async () => {
  const media = {
    read: async () => ({ text: "A menu: dosa 80, idli 40.", tokens: 1240 }),
  };
  const { prisma, storage, service } = build("ws-a", undefined, media);

  (prisma.knowledgeSource as any).findUnique = async () => ({
    id: "source-1",
    kind: "FILE",
    title: "menu.png",
    mime: "image/png",
    storagePath: "workspaces/ws-a/agents/agent-1/knowledge/source-1/original.png",
    text: null,
    meta: { kind: "image", mime: "image/png", width: 1, height: 1 },
    extractTokens: 0,
    replacesSourceId: null,
    status: "PROCESSING",
    leaseToken: "tok-1",
    agent: { model: "gpt-4o-mini" },
  });
  (storage as any).download = async () => PNG;

  const writes: any[] = [];
  (prisma.knowledgeSource as any).updateMany = async ({ data }: any) => {
    writes.push(data);
    return { count: 1 };
  };

  await service.index("source-1", "tok-1");

  const ready = writes.find((data) => data.status === "READY");
  assert.equal(ready?.extractTokens, 1240);
  // The picture's size was written at upload; a read that carries no meta must
  // not erase it.
  assert.equal(ready?.meta, undefined);
});

test("retrieval is scoped by workspace as well as agent", async () => {
  const captured: string[] = [];
  const prisma = {
    $executeRawUnsafe: async () => 1,
    $queryRaw: (strings: TemplateStringsArray) => {
      captured.push(strings.join(" ? "));
      return [];
    },
    $transaction: async (input: any[]) => Promise.all(input),
  };
  const service = new RetrievalService(prisma as any, new FakeProvider() as any);

  await service.search(
    { agentId: "agent-1", workspaceId: "ws-a" },
    "how much is delivery?",
  );

  const sql = captured.join(" ");
  assert.match(sql, /s\.agent_id/);
  assert.match(sql, /a\.workspace_id/);
  assert.match(sql, /s\.status = 'READY'/);
});
