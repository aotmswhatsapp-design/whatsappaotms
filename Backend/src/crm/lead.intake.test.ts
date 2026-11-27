import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaService } from "../prisma/prisma.service";
import type { StoredInbound } from "../inbox/inbox.store";
import { CrmSettingsService } from "./crm.settings";
import { MANUAL_REASON } from "./interest.rules";
import { LeadIntake, tagsFor } from "./lead.intake";
import { RoundRobin } from "./round.robin";
import type { TasksService } from "./tasks.service";

const inbound: StoredInbound = {
  conversationId: "c-1",
  messageId: "m-1",
  kind: "TEXT",
  body: "how much is the price",
};

const conversation = {
  id: "c-1",
  interest: "UNKNOWN" as const,
  interestScore: null,
  interestReason: null,
  interestAt: null,
  assignedToUserId: null as string | null,
  contactId: "contact-1",
  contact: { tags: ["vip"], profileName: "Dosa", waId: "919900000000" },
};

function build(options: { assigned?: string | null; reason?: string | null } = {}) {
  const writes: Record<string, unknown>[] = [];
  const tasks: unknown[] = [];
  const prisma = {
    workspace: { findUniqueOrThrow: async () => ({ ownerId: "owner-1" }) },
    conversation: {
      findUnique: async () => ({
        ...conversation,
        assignedToUserId: options.assigned ?? null,
        interestReason: options.reason ?? null,
        // A manual override only freezes intake while it is fresh, so the row
        // has to carry the moment it was made: without it the test would run
        // with no override in place and prove nothing.
        interestAt: options.reason === MANUAL_REASON ? new Date() : null,
      }),
      update: async (args: Record<string, unknown>) => {
        writes.push(args);
        return conversation;
      },
      updateMany: async (args: Record<string, unknown>) => {
        writes.push(args);
        return { count: 1 };
      },
    },
    contact: {
      update: async (args: Record<string, unknown>) => {
        writes.push(args);
        return conversation.contact;
      },
    },
    message: { findFirst: async () => ({ body: "hello" }) },
    followUpTask: {
      updateMany: async (args: Record<string, unknown>) => {
        writes.push(args);
        return { count: 1 };
      },
    },
  } as unknown as PrismaService;

  const settings = {
    plan: async () => ({ designation: "Sales", autoAssign: true, autoTask: true, taskDueHours: 24 }),
  } as unknown as CrmSettingsService;

  let picks = 0;
  const robin = {
    pick: async () => {
      picks += 1;
      return "user-2";
    },
  } as unknown as RoundRobin;

  let creates = 0;
  const taskService = {
    create: async (input: unknown) => {
      creates += 1;
      tasks.push(input);
      return "task-1";
    },
  } as unknown as TasksService;

  return {
    intake: new LeadIntake(prisma, settings, robin, taskService),
    writes,
    tasks,
    picks: () => picks,
    creates: () => creates,
  };
}

test("an interested lead is staged, tagged, assigned and given one task", async () => {
  const { intake, writes, tasks, picks, creates } = build();

  await intake.consider({ workspaceId: "ws-1" }, [inbound]);

  const stage = writes.find((row) => "data" in row && "interest" in (row.data as object));
  assert.equal((stage?.data as { interest: string }).interest, "INTERESTED");

  const tags = writes.find((row) => "data" in row && "tags" in (row.data as object));
  assert.deepEqual((tags?.data as { tags: string[] }).tags, ["vip", "interested"]);

  assert.equal(picks(), 1);
  assert.equal(creates(), 1);
  assert.equal((tasks[0] as { assignedToUserId: string }).assignedToUserId, "user-2");
});

test("a refusal cancels the open task and assigns nobody", async () => {
  const { intake, writes, picks, creates } = build();

  await intake.consider({ workspaceId: "ws-1" }, [
    { ...inbound, body: "stop messaging me" },
  ]);

  assert.equal(picks(), 0);
  assert.equal(creates(), 0);
  assert.equal(
    writes.some((row) => "where" in row && (row.where as { status?: string }).status === "OPEN"),
    true,
  );
});

test("a message with no signal writes the stage and nothing else", async () => {
  const { intake, picks, creates } = build();

  await intake.consider({ workspaceId: "ws-1" }, [{ ...inbound, body: "hello there" }]);

  assert.equal(picks(), 0);
  assert.equal(creates(), 0);
});

test("a thread that already has an assignee is never reassigned", async () => {
  const { intake, picks, creates } = build({ assigned: "user-9" });

  await intake.consider({ workspaceId: "ws-1" }, [inbound]);

  assert.equal(picks(), 0);
  assert.equal(creates(), 1);
});

test("a stage write that loses a race stops the rest", async () => {
  const { intake, writes, picks, creates } = build();
  (intake as unknown as { prisma: { conversation: { updateMany: (args: unknown) => Promise<{ count: number }> } } }).prisma.conversation.updateMany =
    async (args) => {
      writes.push(args as Record<string, unknown>);
      return { count: 0 };
    };

  await intake.consider({ workspaceId: "ws-1" }, [inbound]);

  assert.equal(picks(), 0);
  assert.equal(creates(), 0);
  // The stage write is the only write attempted.
  assert.equal(writes.length, 1);
});

test("a lost assignment claim still gives the task to the real assignee", async () => {
  const { intake, tasks, picks } = build();
  const rows = (
    intake as unknown as {
      prisma: {
        conversation: {
          updateMany: (args: { where: { assignedToUserId?: unknown } }) => Promise<{ count: number }>;
          findUnique: () => Promise<unknown>;
        };
      };
    }
  ).prisma.conversation;

  rows.updateMany = async (args) =>
    "assignedToUserId" in args.where ? { count: 0 } : { count: 1 };

  let lookups = 0;
  rows.findUnique = async () => {
    lookups += 1;
    // Unassigned when the lead is read, somebody else's when the claim lands.
    return lookups === 1 ? conversation : { assignedToUserId: "manual-agent" };
  };

  await intake.consider({ workspaceId: "ws-1" }, [inbound]);

  assert.equal(picks(), 1);
  assert.equal((tasks[0] as { assignedToUserId: string }).assignedToUserId, "manual-agent");
});

test("a manual override is left alone", async () => {
  const { intake, writes, picks } = build({ reason: MANUAL_REASON });

  await intake.consider({ workspaceId: "ws-1" }, [inbound]);

  assert.equal(writes.length, 0);
  assert.equal(picks(), 0);
});

test("a failing write is swallowed, never raised at the webhook", async () => {
  const { intake } = build();
  (intake as unknown as { prisma: { conversation: { findUnique: () => Promise<never> } } }).prisma.conversation.findUnique =
    async () => {
      throw new Error("database is down");
    };

  await intake.consider({ workspaceId: "ws-1" }, [inbound]);
});

test("a workspace lookup that fails is swallowed too", async () => {
  const { intake, writes } = build();
  (intake as unknown as { prisma: { workspace: { findUniqueOrThrow: () => Promise<never> } } }).prisma.workspace.findUniqueOrThrow =
    async () => {
      throw new Error("database is down");
    };

  await intake.consider({ workspaceId: "ws-1" }, [inbound]);

  assert.equal(writes.length, 0);
});

test("a non-text message is skipped", async () => {
  const { intake, writes } = build();

  await intake.consider({ workspaceId: "ws-1" }, [{ ...inbound, kind: "IMAGE", body: null }]);

  assert.equal(writes.length, 0);
});

test("tags keep what the contact already carried", () => {
  assert.deepEqual(tagsFor(["vip", "not-interested"], "INTERESTED"), ["vip", "interested"]);
  assert.deepEqual(tagsFor(["vip"], "UNKNOWN"), ["vip"]);
});
