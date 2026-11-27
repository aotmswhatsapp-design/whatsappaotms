import assert from "node:assert/strict";
import { test } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import type { WorkspaceRole } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import type { PrismaService } from "../prisma/prisma.service";
import type { WorkspacesService } from "../workspaces/workspaces.service";
import type { ListConversationsDto } from "./dto/list-conversations.dto";
import type { UpdateConversationDto } from "./dto/update-conversation.dto";
import { InboxService } from "./inbox.service";

const claims = { id: "user-1", email: "one@test.dev" } as AuthClaims;

const row = {
  id: "c-1",
  status: "OPEN" as const,
  interest: "UNKNOWN" as const,
  interestScore: null,
  interestReason: null,
  interestAt: null,
  followUpTasks: [],
  contact: {
    id: "contact-1",
    waId: "919900000000",
    profileName: "Dosa",
    phoneDisplay: "+91 99000 00000",
  },
  assignedTo: null,
  agent: null,
  lastMessageAt: new Date("2026-11-27T10:00:00Z"),
  lastMessagePreview: "Two dosas please",
  lastInboundAt: null,
  unreadCount: 0,
  aiPausedAt: null,
  aiPauseReason: null,
};

/**
 * The queue rule lives in the `where` the service hands Prisma, so these tests
 * read that argument instead of rows: what matters is that an Agent's read is
 * narrowed and a Manager's is not.
 */
function service(role: WorkspaceRole) {
  const queried: unknown[] = [];
  const prisma = {
    conversation: {
      findMany: async (args: { where: unknown }) => {
        queried.push(args.where);
        return [];
      },
      findFirst: async () => row,
      update: async () => row,
    },
    workspaceMember: { findUnique: async () => ({ userId: "user-2" }) },
  } as unknown as PrismaService;

  const workspaces = {
    primaryFor: async () => ({ userId: "user-1", workspaceId: "ws-1", role }),
  } as unknown as WorkspacesService;

  return {
    inbox: new InboxService(prisma, workspaces, null!, null!, null!),
    lastQuery: () => queried[queried.length - 1],
  };
}

const noQuery = {} as ListConversationsDto;

test("an Agent's queue is their own threads plus the unclaimed ones", async () => {
  const { inbox, lastQuery } = service("AGENT");

  await inbox.list(claims, noQuery);

  assert.deepEqual(lastQuery(), {
    workspaceId: "ws-1",
    AND: [
      {
        OR: [
          { assignedToUserId: "user-1" },
          { assignedToUserId: null, status: { not: "CLOSED" } },
        ],
      },
    ],
  });
});

test("a Manager reads the whole workspace", async () => {
  const { inbox, lastQuery } = service("MANAGER");

  await inbox.list(claims, noQuery);

  assert.deepEqual(lastQuery(), { workspaceId: "ws-1" });
});

test("an Admin reads the whole workspace", async () => {
  const { inbox, lastQuery } = service("ADMIN");

  await inbox.list(claims, noQuery);

  assert.deepEqual(lastQuery(), { workspaceId: "ws-1" });
});

test("a search narrows an Agent's queue instead of replacing it", async () => {
  const { inbox, lastQuery } = service("AGENT");

  await inbox.list(claims, { search: "dosa" } as ListConversationsDto);

  const where = lastQuery() as {
    AND: unknown[];
    OR: { contact?: { profileName?: unknown }; lastMessagePreview?: unknown }[];
  };

  // The queue is its own clause, so the term cannot widen it back out.
  assert.deepEqual(where.AND, [
    {
      OR: [
        { assignedToUserId: "user-1" },
        { assignedToUserId: null, status: { not: "CLOSED" } },
      ],
    },
  ]);
  assert.equal(where.OR.length >= 2, true);
});

test("asking for a colleague's threads still finds nothing for an Agent", async () => {
  const { inbox, lastQuery } = service("AGENT");

  await inbox.list(claims, {
    assignee: "11111111-1111-4111-8111-111111111111",
  } as ListConversationsDto);

  const where = lastQuery() as {
    assignedToUserId: string;
    AND: unknown[];
  };

  assert.equal(where.assignedToUserId, "11111111-1111-4111-8111-111111111111");
  assert.equal(where.AND.length, 1);
});

test("an Agent cannot hand a conversation to somebody else", async () => {
  const { inbox } = service("AGENT");

  await assert.rejects(
    () =>
      inbox.update(claims, "c-1", {
        assignedToUserId: "user-2",
      } as UpdateConversationDto),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      assert.equal(
        (error.getResponse() as { code: string }).code,
        "ASSIGN_REQUIRED",
      );
      return true;
    },
  );
});

test("an Agent may still take a conversation for themselves", async () => {
  const { inbox } = service("AGENT");

  const updated = await inbox.update(claims, "c-1", {
    assignedToUserId: "user-1",
  } as UpdateConversationDto);

  assert.equal(updated.conversation.id, "c-1");
});

test("a Manager may hand a conversation to anybody in the workspace", async () => {
  const { inbox } = service("MANAGER");

  const updated = await inbox.update(claims, "c-1", {
    assignedToUserId: "user-2",
  } as UpdateConversationDto);

  assert.equal(updated.conversation.id, "c-1");
});

test("a stage filter narrows the queue like the status filter", async () => {
  const { inbox, lastQuery } = service("MANAGER");

  await inbox.list(claims, { interest: "INTERESTED" } as ListConversationsDto);

  assert.equal((lastQuery() as { interest?: string }).interest, "INTERESTED");
});

test("the Follow-up filter asks for a thread that still owes a task", async () => {
  const { inbox, lastQuery } = service("MANAGER");

  await inbox.list(claims, { followUp: "open" } as ListConversationsDto);

  assert.deepEqual(lastQuery(), {
    workspaceId: "ws-1",
    interest: "INTERESTED",
    followUpTasks: { some: { status: "OPEN" } },
  });
});

test("the Follow-up filter narrows an Agent's queue instead of replacing it", async () => {
  const { inbox, lastQuery } = service("AGENT");

  await inbox.list(claims, { followUp: "open" } as ListConversationsDto);

  const where = lastQuery() as {
    AND?: unknown;
    followUpTasks?: unknown;
  };

  assert.deepEqual(where.AND, [
    {
      OR: [
        { assignedToUserId: "user-1" },
        { assignedToUserId: null, status: { not: "CLOSED" } },
      ],
    },
  ]);
  assert.deepEqual(where.followUpTasks, { some: { status: "OPEN" } });
  assert.equal((where as { interest?: string }).interest, "INTERESTED");
});
