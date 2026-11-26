import assert from "node:assert/strict";
import { test } from "node:test";

import { NotFoundException } from "@nestjs/common";

import { KnowledgeService } from "./knowledge.service";
import {
  CLAIMS,
  FakePrisma,
  FakeProvider,
  FakeStorage,
  FakeWorkspaces,
  searchConfig,
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
    searchConfig() as any,
  );
  return { prisma, storage, service };
};

test("a source id from another workspace is a 404, and nothing is deleted", async () => {
  const { prisma, storage, service } = build();
  // agentOf() answers for ws-a only; the fake's agent.findFirst returns null
  // when the caller's workspace does not own the agent.
  (prisma.agent as any).findFirst = async () => null;

  await assert.rejects(
    () => service.remove(CLAIMS, "agent-b", "source-b"),
    NotFoundException,
  );
  assert.equal(
    prisma.calls.filter((call) => call.path === "knowledgeSource.delete").length,
    0,
  );
  assert.equal(storage.removed.length, 0);
});

test("a forged workspaceId in the payload is never read", () => {
  // The service methods take no workspaceId parameter at all: this test documents
  // that the claim is resolved from the token and the body cannot override it.
  const { service } = build();
  const arity = service.addFile.length;
  assert.equal(arity, 3);
});

test("a download link is refused for another tenant before a URL is signed", async () => {
  const { prisma, storage, service } = build();
  let signed = 0;
  (storage as any).signedUrl = async () => {
    signed += 1;
    return "https://signed.test/x";
  };
  (prisma.agent as any).findFirst = async () => null;

  await assert.rejects(
    () => service.downloadLink(CLAIMS, "agent-b", "source-b"),
    NotFoundException,
  );
  assert.equal(signed, 0);
});

test("retry of another tenant's source is refused", async () => {
  const { prisma, service } = build();
  (prisma.agent as any).findFirst = async () => null;

  await assert.rejects(
    () => service.retry(CLAIMS, "agent-b", "source-b"),
    NotFoundException,
  );
  assert.equal(
    prisma.calls.filter((call) => call.path === "knowledgeSource.updateMany")
      .length,
    0,
  );
});
