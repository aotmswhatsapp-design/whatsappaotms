import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_MEDIA_BYTES,
  type InboxSender,
  type SendTarget,
} from "../../inbox/inbox.sender";
import type { MediaStorage } from "../../inbox/media.storage";
import type { PrismaService } from "../../prisma/prisma.service";
import { DocumentsService } from "./documents.service";

const target: SendTarget = {
  workspaceId: "ws-1",
  conversationId: "conv-1",
  waId: "919999999999",
  account: {
    phoneNumberId: "1543627538823509",
    graphVersion: "v21.0",
    accessTokenCipher: "cipher",
  },
};

const row = (over: Record<string, unknown> = {}) => ({
  id: "src-1",
  title: "BUILD MARQUE Brochure 2026.pdf",
  mime: "application/pdf",
  storagePath: "workspaces/ws-1/agents/ag-1/knowledge/src-1/original.pdf",
  updatedAt: new Date("2026-11-01T00:00:00Z"),
  ...over,
});

/**
 * The three seams, faked at their narrowest: the query as it was written, the
 * path that was read, and the request that was sent.
 */
function harness(
  options: {
    rows?: ReturnType<typeof row>[];
    queryFails?: boolean;
    read?: () => Promise<Buffer>;
    send?: (request: Record<string, unknown>) => Promise<{ id: string }>;
  } = {},
) {
  const queries: { where: Record<string, unknown> }[] = [];
  const downloads: string[] = [];
  const sends: Record<string, unknown>[] = [];

  const prisma = {
    knowledgeSource: {
      findMany: async (query: { where: Record<string, unknown> }) => {
        queries.push(query);
        if (options.queryFails) throw new Error("the pool is closed");
        return options.rows ?? [];
      },
    },
  };

  const storage = {
    download: async (path: string) => {
      downloads.push(path);
      return options.read ? options.read() : Buffer.from("%PDF-1.7 brochure");
    },
  };

  const sender = {
    media: async (request: Record<string, unknown>) => {
      sends.push(request);
      return options.send ? options.send(request) : { id: "msg-1" };
    },
  };

  return {
    service: new DocumentsService(
      prisma as unknown as PrismaService,
      storage as unknown as MediaStorage,
      sender as unknown as InboxSender,
    ),
    queries,
    downloads,
    sends,
  };
}

const deliver = (
  service: DocumentsService,
  question: string,
): ReturnType<DocumentsService["deliver"]> =>
  service.deliver({ workspaceId: "ws-1", agentId: "ag-1", question, target });

test("the file the customer named is the one that leaves", async () => {
  const { service, downloads, sends } = harness({ rows: [row()] });

  const outcome = await deliver(service, "Send me the AOTMS brochure PDF");

  assert.ok(outcome.sent);
  if (!outcome.sent) return;

  assert.equal(outcome.messageId, "msg-1");
  assert.equal(outcome.name, "BUILD MARQUE Brochure 2026.pdf");
  assert.deepEqual(downloads, [row().storagePath]);

  const file = sends[0]?.file as {
    mimetype: string;
    originalname: string;
    size: number;
  };

  // The name and the type are what turn Meta's media upload into a document
  // the customer can open, not a link they have to trust.
  assert.equal(file.originalname, "BUILD MARQUE Brochure 2026.pdf");
  assert.equal(file.mimetype, "application/pdf");
  assert.equal(file.size, Buffer.from("%PDF-1.7 brochure").length);
  assert.equal(sends[0]?.agentId, "ag-1");
  assert.equal(sends[0]?.caption, null);
});

test("a question that is not a request never touches the database", async () => {
  const { service, queries, sends } = harness({ rows: [row()] });

  const outcome = await deliver(service, "What does the brochure say about delivery?");

  assert.equal(outcome.sent, false);
  if (outcome.sent) return;

  assert.equal(outcome.reason, "not-asked");
  assert.equal(queries.length, 0);
  assert.equal(sends.length, 0);
});

test("only this agent's ready files, under the ceiling, are candidates", async () => {
  const { service, queries } = harness({ rows: [row()] });

  await deliver(service, "send me the brochure");

  const where = queries[0]?.where ?? {};

  assert.equal(where.agentId, "ag-1");
  assert.equal(where.kind, "FILE");
  // A row that failed extraction may be a corrupt file, and a customer cannot
  // un-receive a document.
  assert.equal(where.status, "READY");
  assert.deepEqual(where.size, { lte: MAX_MEDIA_BYTES });
  assert.deepEqual(where.storagePath, { not: null });
  // Defence in depth: the tenant is named, not implied by the agent id.
  assert.deepEqual(where.agent, { workspaceId: "ws-1" });
});

test("a name the agent does not have falls through without sending", async () => {
  const { service, downloads, sends } = harness({ rows: [row()] });

  const outcome = await deliver(service, "send me the warranty policy");

  assert.equal(outcome.sent, false);
  if (outcome.sent) return;

  assert.equal(outcome.reason, "no-match");
  assert.equal(downloads.length, 0);
  assert.equal(sends.length, 0);
});

test("a file storage cannot hand back is not sent as if it were", async () => {
  const { service, sends } = harness({
    rows: [row()],
    read: async () => {
      throw new Error("Could not read the stored file (storage answered 404).");
    },
  });

  const outcome = await deliver(service, "send me the brochure");

  assert.equal(outcome.sent, false);
  if (outcome.sent) return;

  assert.equal(outcome.reason, "unreadable");
  assert.equal(sends.length, 0);
});

test("a send that fails is reported, never thrown at the reply path", async () => {
  const { service } = harness({
    rows: [row()],
    send: async () => {
      throw new Error("Media upload failed.");
    },
  });

  const outcome = await deliver(service, "send me the brochure");

  assert.equal(outcome.sent, false);
  if (outcome.sent) return;

  assert.equal(outcome.reason, "unreadable");
});

test("a database that cannot answer is a miss, not a failed reply", async () => {
  const { service, sends } = harness({ queryFails: true });

  const outcome = await deliver(service, "send me the brochure");

  assert.equal(outcome.sent, false);
  if (outcome.sent) return;

  assert.equal(outcome.reason, "no-match");
  assert.equal(sends.length, 0);
});