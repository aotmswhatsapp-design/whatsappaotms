import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { FollowUpStatus, Prisma } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { ROLE_RANK } from "../workspaces/workspace-roles.decorator";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { CrmSettingsService } from "./crm.settings";
import { MANUAL_REASON } from "./interest.rules";
import type { UpdateTaskDto } from "./crm.dto";

const TASK_SELECT = {
  id: true,
  title: true,
  note: true,
  dueAt: true,
  status: true,
  completedAt: true,
  conversationId: true,
  assignedTo: { select: { id: true, fullName: true } },
  conversation: {
    select: { contact: { select: { id: true, profileName: true, waId: true } } },
  },
} satisfies Prisma.FollowUpTaskSelect;

export type TaskSource = Prisma.FollowUpTaskGetPayload<{ select: typeof TASK_SELECT }>;

export interface TaskView {
  id: string;
  title: string;
  note: string | null;
  dueAt: string | null;
  status: FollowUpStatus;
  completedAt: string | null;
  /** True once the deadline has passed and the task is still open. */
  overdue: boolean;
  conversationId: string;
  contact: { id: string; name: string | null; waId: string } | null;
  assignedTo: { id: string; name: string | null } | null;
}

export function taskView(row: TaskSource, now = Date.now()): TaskView {
  const due = row.dueAt;

  return {
    id: row.id,
    title: row.title,
    note: row.note,
    dueAt: due ? due.toISOString() : null,
    status: row.status,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    overdue: row.status === "OPEN" && due !== null && due.getTime() < now,
    conversationId: row.conversationId,
    contact: row.conversation.contact
      ? {
          id: row.conversation.contact.id,
          name: row.conversation.contact.profileName,
          waId: row.conversation.contact.waId,
        }
      : null,
    assignedTo: row.assignedTo
      ? { id: row.assignedTo.id, name: row.assignedTo.fullName }
      : null,
  };
}

/**
 * Follow-up tasks: one open task per thread, created only here so the dedupe
 * has a single home.
 *
 * Not a `$transaction`: the partial unique index and the read below converge
 * on the same answer from a retried delivery, which is what idempotency needs.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly settings: CrmSettingsService,
  ) {}

  /** Returns the new id, or null when the thread already has an open task. */
  async create(input: {
    workspaceId: string;
    conversationId: string;
    title: string;
    note: string | null;
    dueAt: Date | null;
    assignedToUserId: string | null;
  }): Promise<string | null> {
    const open = await this.prisma.followUpTask.findFirst({
      where: { conversationId: input.conversationId, status: "OPEN" },
      select: { id: true },
    });

    if (open) return null;

    try {
      const created = await this.prisma.followUpTask.create({
        data: input,
        select: { id: true },
      });

      return created.id;
    } catch (error) {
      // Two deliveries in the same instant: the index picks one, and the loser
      // treats it as "already handled" rather than failing the webhook.
      if ((error as { code?: string }).code === "P2002") return null;
      throw error;
    }
  }

  /**
   * A manager's own errand on a lead, from the board.
   *
   * Goes through `create` above, so the one-open-task rule still has one
   * home. The title, the reason and the deadline are derived here rather
   * than taken from the caller; a lead nobody picked up falls to the owner,
   * exactly as intake does when rotation finds nobody.
   */
  async createForConversation(
    claims: AuthClaims,
    conversationId: string,
  ): Promise<{ ok: true }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
      select: {
        id: true,
        assignedToUserId: true,
        interestReason: true,
        contact: { select: { profileName: true, waId: true } },
      },
    });

    if (!conversation) {
      throw new NotFoundException({
        code: "CONVERSATION_MISSING",
        message: "Unknown conversation.",
      });
    }

    const [workspace, plan] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { ownerId: true },
      }),
      this.settings.plan(workspaceId),
    ]);

    const name =
      conversation.contact?.profileName ?? conversation.contact?.waId ?? "this customer";
    const reason = conversation.interestReason;

    const created = await this.create({
      workspaceId,
      conversationId: conversation.id,
      title: `Follow up with ${name}`,
      note:
        reason && reason !== MANUAL_REASON
          ? `Interested: ${reason}`
          : "Added by a manager from the board",
      dueAt: new Date(Date.now() + plan.taskDueHours * 60 * 60 * 1000),
      assignedToUserId: conversation.assignedToUserId ?? workspace.ownerId,
    });

    if (!created) {
      throw new ConflictException({
        code: "TASK_EXISTS",
        message: "This lead already has an open follow-up.",
      });
    }

    return { ok: true };
  }

  async list(
    claims: AuthClaims,
    scope: "mine" | "all",
  ): Promise<{ tasks: TaskView[] }> {
    const { workspaceId, userId, role } = await this.workspaces.primaryFor(claims);

    if (scope === "all" && ROLE_RANK[role] < ROLE_RANK.MANAGER) {
      throw new ForbiddenException({
        code: "SCOPE_FORBIDDEN",
        message: "Only a manager reads every follow-up in the workspace.",
      });
    }

    const rows = await this.prisma.followUpTask.findMany({
      where:
        scope === "mine"
          ? { workspaceId, assignedToUserId: userId, status: "OPEN" }
          : { workspaceId, status: "OPEN" },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: 200,
      select: TASK_SELECT,
    });

    return { tasks: rows.map((row) => taskView(row)) };
  }

  async update(
    claims: AuthClaims,
    id: string,
    dto: UpdateTaskDto,
  ): Promise<{ task: TaskView }> {
    const { workspaceId, userId, role } = await this.workspaces.primaryFor(claims);

    const task = await this.prisma.followUpTask.findFirst({
      where: { id, workspaceId },
      select: { id: true, assignedToUserId: true },
    });

    if (!task) {
      throw new NotFoundException({ code: "TASK_MISSING", message: "Unknown task." });
    }

    if (
      role === "AGENT" &&
      task.assignedToUserId !== null &&
      task.assignedToUserId !== userId
    ) {
      throw new ForbiddenException({
        code: "TASK_NOT_YOURS",
        message: "That follow-up belongs to somebody else.",
      });
    }

    const data: Prisma.FollowUpTaskUpdateInput = {};

    if (dto.dueAt !== undefined) {
      const dueAt = dto.dueAt === null ? null : new Date(dto.dueAt);

      // `IsISO8601` accepts week and ordinal dates that `Date` cannot read; a
      // deadline nobody can parse is a 400 now, not a failed write later.
      if (dueAt && !Number.isFinite(dueAt.getTime())) {
        throw new BadRequestException({
          code: "DUE_AT_INVALID",
          message: "dueAt must be a date this server can read.",
        });
      }

      data.dueAt = dueAt;
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
      // Nobody did the work on a cancelled task, so it carries no stamp.
      data.completedAt = dto.status === "DONE" ? new Date() : null;
    }

    await this.prisma.followUpTask.update({ where: { id: task.id }, data });

    const row = await this.prisma.followUpTask.findUniqueOrThrow({
      where: { id: task.id },
      select: TASK_SELECT,
    });

    return { task: taskView(row) };
  }

  /**
   * The `wa.me` link for a follow-up, built on the server so the wording is one
   * place.
   *
   * This is the only way to message from a personal number: only a number
   * registered to the workspace's WABA can send through the Cloud API. Nothing
   * confirms delivery, and the reply lands on the member's phone rather than in
   * this inbox — the screen says so.
   */
  async waLink(claims: AuthClaims, id: string): Promise<{ url: string; text: string }> {
    const { workspaceId, userId } = await this.workspaces.primaryFor(claims);

    const task = await this.prisma.followUpTask.findFirst({
      where: { id, workspaceId },
      select: {
        id: true,
        conversationId: true,
        assignedToUserId: true,
        conversation: {
          select: { contact: { select: { profileName: true, waId: true } } },
        },
      },
    });

    if (!task) {
      throw new NotFoundException({ code: "TASK_MISSING", message: "Unknown task." });
    }

    if (task.assignedToUserId !== userId) {
      throw new ForbiddenException({
        code: "TASK_NOT_YOURS",
        message: "That follow-up belongs to somebody else.",
      });
    }

    const [member, workspace] = await Promise.all([
      this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { personalWhatsApp: true, user: { select: { fullName: true } } },
      }),
      this.prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { name: true },
      }),
    ]);

    const personal = member?.personalWhatsApp ?? "";

    // Only a member with a number on file may use this: the reply lands on that
    // phone, and the owner set it for exactly this.
    if (!/^\d{8,15}$/.test(personal)) {
      throw new ConflictException({
        code: "NO_PERSONAL_NUMBER",
        message: "Ask the workspace owner to add your WhatsApp number on the Team screen.",
      });
    }

    const contact = task.conversation.contact;

    if (!contact) {
      throw new ConflictException({
        code: "NO_CUSTOMER_NUMBER",
        message: "This conversation has no customer number to message.",
      });
    }

    const greeting = contact.profileName?.trim() || "there";
    const agent = member?.user.fullName?.trim().split(/\s+/)[0] || "our team";
    const text = `Hi ${greeting}, ${agent} from ${workspace.name} here about your enquiry. Is now a good time to talk?`;
    // `wa.me/<number>` opens a chat WITH that number, so it is the customer who
    // goes in the path — the message is sent from the member's own WhatsApp.
    const url = `https://wa.me/${contact.waId}?text=${encodeURIComponent(text)}`;

    // The thread records what actually happened: a customer writing back will
    // read this note beside their own messages.
    await this.prisma.internalNote.create({
      data: {
        conversationId: task.conversationId,
        authorUserId: userId,
        body: `Follow-up on personal WhatsApp: ${text}`,
      },
    });

    return { url, text };
  }
}
