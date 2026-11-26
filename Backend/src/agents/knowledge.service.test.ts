import assert from "node:assert/strict";
import { test } from "node:test";

import { ConflictException } from "@nestjs/common";

import { KnowledgeService } from "./knowledge.service";
import { RetrievalService } from "./retrieval.service";
import {
  CLAIMS,
  FakePrisma,
  FakeProvider,
  FakeStorage,
  FakeWorkspaces,
} from "./testing/fakes";

const build = (workspaceId = "ws-a") => {
  const prisma = new FakePrisma();
  const storage = new FakeStorage();
  const service = new KnowledgeService(
    prisma as any,
    new FakeWorkspaces(workspaceId) as any,
    storage as any,
    new FakeProvider() as any,
    {} as any,
    { get: () => undefined } as any,
  );
  return { prisma, storage, service };
};

const PDF = {
  buffer: Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF"),
  originalname: "prices.pdf",
  mimetype: "application/pdf",
  size: 33,
};

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

test("a race that slips past the lookup is still a 409, and the object is removed", async () => {
  const { prisma, storage, service } = build();
  (prisma.knowledgeSource as any).create = async () => {
    throw Object.assign(new Error("unique"), { code: "P2002" });
  };

  await assert.rejects(
    () => service.addFile(CLAIMS, "agent-1", PDF as any),
    ConflictException,
  );
  assert.equal(storage.removed.length, 1);
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
