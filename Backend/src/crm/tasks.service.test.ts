import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import type { PrismaService } from "../prisma/prisma.service";
import type { WorkspacesService } from "../workspaces/workspaces.service";
import type { CrmSettingsService } from "./crm.settings";
import { TasksService } from "./tasks.service";

const claims = { id: "user-1", email: "one@test.dev" } as AuthClaims;

const task = {
  id: "task-1",
  title: "Follow up with Dosa",
  note: "Interested: matched",
  // An hour ago, so "overdue" does not depend on the day the suite runs.
  dueAt: new Date(Date.now() - 60 * 60 * 1000),
  status: "OPEN" as const,
  completedAt: null,
  conversationId: "c-1",
  assignedTo: { id: "user-1", fullName: "One" },
  conversation: { contact: { id: "contact-1", profileName: "Dosa", waId: "919900000000" } },
};

function service(role: "OWNER" | "ADMIN" | "MANAGER" | "AGENT") {
  const created: unknown[] = [];
  const updated: unknown[] = [];
  const listed: { where: Record<string, unknown> }[] = [];
  const prisma = {
    followUpTask: {
      // `create` asks for an open task on the thread and finds none; every other
      // caller looks a task up by id and finds one, assigned to the caller.
      findFirst: async (args: { where: { id?: string } }) =>
        args.where.id ? { ...task, assignedToUserId: "user-1" } : null,
      create: async (args: { data: unknown }) => {
        created.push(args.data);
        return { id: "task-1" };
      },
      findMany: async (args: { where: Record<string, unknown> }) => {
        listed.push(args);
        return [task];
      },
      update: async (args: { data: unknown }) => {
        updated.push(args.data);
        return task;
      },
      findUniqueOrThrow: async () => task,
    },
    workspaceMember: {
      findUnique: async () => ({ personalWhatsApp: "919876543210", user: { fullName: "One Two" } }),
    },
    conversation: {
      findFirst: async () => ({
        id: "c-1",
        assignedToUserId: null as string | null,
        interestReason: null as string | null,
        contact: { profileName: "Dosa", waId: "919900000000" },
      }),
    },
    workspace: { findUniqueOrThrow: async () => ({ name: "Dosa Corner", ownerId: "owner-1" }) },
    internalNote: { create: async () => ({ id: "note-1" }) },
  } as unknown as PrismaService;

  const workspaces = {
    primaryFor: async () => ({ userId: "user-1", workspaceId: "ws-1", role }),
  } as unknown as WorkspacesService;

  const settings = {
    plan: async () => ({
      designation: "Sales",
      storedDesignation: "Sales",
      autoAssign: true,
      autoTask: true,
      taskDueHours: 48,
    }),
  } as unknown as CrmSettingsService;

  return {
    tasks: new TasksService(prisma, workspaces, settings),
    created,
    updated,
    listed,
  };
}

const input = {
  workspaceId: "ws-1",
  conversationId: "c-1",
  title: "Follow up with Dosa",
  note: "interested",
  dueAt: new Date("2026-11-28T10:00:00Z"),
  assignedToUserId: "user-2",
};

test("a task is created with the values it was given", async () => {
  const { tasks, created } = service("OWNER");

  assert.equal(await tasks.create(input), "task-1");
  assert.deepEqual(created[0], input);
});

test("an open task already on the thread is not created twice", async () => {
  const { tasks, created } = service("OWNER");
  (tasks as unknown as { prisma: { followUpTask: { findFirst: () => Promise<unknown> } } }).prisma.followUpTask.findFirst =
    async () => ({ id: "existing" });

  assert.equal(await tasks.create(input), null);
  assert.equal(created.length, 0);
});

test("a partial-index race is swallowed, not thrown at the webhook", async () => {
  const { tasks } = service("OWNER");
  (tasks as unknown as { prisma: { followUpTask: { create: () => Promise<unknown> } } }).prisma.followUpTask.create =
    async () => {
      throw Object.assign(new Error("duplicate key"), { code: "P2002" });
    };

  assert.equal(await tasks.create(input), null);
});

test("a manager's task from the board carries what the server derived", async () => {
  const { tasks, created } = service("MANAGER");

  assert.deepEqual(await tasks.createForConversation(claims, "c-1"), { ok: true });

  const input = created[0] as {
    title: string;
    note: string;
    dueAt: Date;
    assignedToUserId: string;
  };
  assert.equal(input.title, "Follow up with Dosa");
  // Nobody picked this lead up, so the owner carries it — as intake does.
  assert.equal(input.assignedToUserId, "owner-1");
  assert.equal(input.note, "Added by a manager from the board");
  // The deadline comes from the routing settings, not from the caller.
  assert.ok(Math.abs(input.dueAt.getTime() - (Date.now() + 48 * 3600_000)) < 5_000);
});

test("a lead that already owes a follow-up refuses a second one", async () => {
  const { tasks } = service("MANAGER");
  (tasks as unknown as { prisma: { followUpTask: { findFirst: () => Promise<unknown> } } }).prisma.followUpTask.findFirst =
    async () => ({ id: "existing" });

  await assert.rejects(() => tasks.createForConversation(claims, "c-1"), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal((error.getResponse() as { code: string }).code, "TASK_EXISTS");
    return true;
  });
});

test("a conversation from another workspace answers 404, not 403", async () => {
  const { tasks } = service("MANAGER");
  (tasks as unknown as { prisma: { conversation: { findFirst: () => Promise<unknown> } } }).prisma.conversation.findFirst =
    async () => null;

  await assert.rejects(() => tasks.createForConversation(claims, "c-1"), NotFoundException);
});

test("an agent reads only their own tasks", async () => {
  const { tasks, listed } = service("AGENT");
  const result = await tasks.list(claims, "mine");

  assert.equal(result.tasks[0].id, "task-1");
  assert.equal(result.tasks[0].overdue, true);
  // The filter is the guarantee, not the view: it must name the workspace and
  // the caller, or an agent could read a colleague's follow-up.
  assert.deepEqual(listed[0].where, {
    workspaceId: "ws-1",
    assignedToUserId: "user-1",
    status: "OPEN",
  });
});

test("an agent may not ask for the whole workspace's tasks", async () => {
  const { tasks } = service("AGENT");

  await assert.rejects(() => tasks.list(claims, "all"), (error: unknown) => {
    assert.ok(error instanceof ForbiddenException);
    assert.equal((error.getResponse() as { code: string }).code, "SCOPE_FORBIDDEN");
    return true;
  });
});

test("an agent may not touch a task that is not theirs", async () => {
  const { tasks } = service("AGENT");
  (tasks as unknown as { prisma: { followUpTask: { findFirst: () => Promise<unknown> } } }).prisma.followUpTask.findFirst =
    async () => ({ ...task, assignedToUserId: "user-2" });

  await assert.rejects(
    () => tasks.update(claims, "task-1", { status: "DONE" }),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      assert.equal((error.getResponse() as { code: string }).code, "TASK_NOT_YOURS");
      return true;
    },
  );
});

test("done carries a stamp and cancelled carries none", async () => {
  const { tasks, updated } = service("OWNER");

  await tasks.update(claims, "task-1", { status: "DONE" });
  assert.equal((updated[0] as { status: string }).status, "DONE");
  assert.ok((updated[0] as { completedAt: Date | null }).completedAt instanceof Date);

  // Nobody did the work on a cancelled task, so it must not read as done.
  await tasks.update(claims, "task-1", { status: "CANCELLED" });
  assert.equal((updated[1] as { completedAt: Date | null }).completedAt, null);
});

test("the link opens the customer's chat and names the agent and the workspace", async () => {
  const { tasks } = service("AGENT");

  const link = await tasks.waLink(claims, "task-1");

  // `wa.me/<number>` is the recipient, so it is the customer's number — the
  // message itself is sent from the member's own WhatsApp.
  assert.equal(link.url.startsWith("https://wa.me/919900000000?text="), true);
  const text = decodeURIComponent(link.url.split("text=")[1]);
  assert.equal(text.includes("Dosa Corner"), true);
  assert.equal(text.includes("One"), true);
  // The internal classifier reason never reaches the customer.
  assert.equal(text.includes("Interested:"), false);
});

test("a member without a personal number is sent to the owner", async () => {
  const { tasks } = service("AGENT");
  (tasks as unknown as { prisma: { workspaceMember: { findUnique: () => Promise<unknown> } } }).prisma.workspaceMember.findUnique =
    async () => ({ personalWhatsApp: null, user: { fullName: "One Two" } });

  await assert.rejects(() => tasks.waLink(claims, "task-1"), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal((error.getResponse() as { code: string }).code, "NO_PERSONAL_NUMBER");
    return true;
  });
});

test("a thread with no customer number cannot make a link", async () => {
  const { tasks } = service("AGENT");
  (tasks as unknown as { prisma: { followUpTask: { findFirst: () => Promise<unknown> } } }).prisma.followUpTask.findFirst =
    async () => ({ ...task, assignedToUserId: "user-1", conversation: { contact: null } });

  await assert.rejects(() => tasks.waLink(claims, "task-1"), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal((error.getResponse() as { code: string }).code, "NO_CUSTOMER_NUMBER");
    return true;
  });
});

test("a date the server cannot read is refused before it reaches the database", async () => {
  const { tasks, updated } = service("OWNER");

  await assert.rejects(
    () => tasks.update(claims, "task-1", { dueAt: "2026-W48-5" }),
    BadRequestException,
  );
  assert.equal(updated.length, 0);
});

test("a task from another workspace answers 404, not 403", async () => {
  const { tasks } = service("OWNER");
  (tasks as unknown as { prisma: { followUpTask: { findFirst: () => Promise<unknown> } } }).prisma.followUpTask.findFirst =
    async () => null;

  await assert.rejects(() => tasks.update(claims, "task-1", { status: "DONE" }), NotFoundException);
});
