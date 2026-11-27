import { Injectable, Logger } from "@nestjs/common";
import type { LeadInterest } from "@prisma/client";

import type { StoredInbound } from "../inbox/inbox.store";
import { PrismaService } from "../prisma/prisma.service";
import { CrmSettingsService, type RoutingPlan } from "./crm.settings";
import { MANUAL_REASON, NO_SIGNAL, classify } from "./interest.rules";
import { RoundRobin } from "./round.robin";
import { TasksService } from "./tasks.service";

/** How long a manager's decision outranks the classifier. */
export const MANUAL_FREEZE_MS = 24 * 60 * 60 * 1000;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown failure";
}

/**
 * The contact tags a stage implies. The old tag is replaced rather than
 * stacked, so a thread that swings twice does not read as both.
 */
export function tagsFor(tags: readonly string[], interest: LeadInterest): string[] {
  const keep = tags.filter((tag) => tag !== "interested" && tag !== "not-interested");

  if (interest === "INTERESTED") return [...keep, "interested"];
  if (interest === "NOT_INTERESTED") return [...keep, "not-interested"];
  return keep;
}

/**
 * Reads each newly stored inbound message and acts on it.
 *
 * Called beside the AI intake, immediately after `InboxStore.record()`, and
 * never allowed to throw: a CRM bug must not make Meta retry a message that is
 * already stored. Idempotency comes from the data — only rows in `StoredInbound`
 * are considered, an existing assignee is never overwritten, and one open task
 * per thread is enforced by a partial unique index.
 */
@Injectable()
export class LeadIntake {
  private readonly logger = new Logger(LeadIntake.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CrmSettingsService,
    private readonly robin: RoundRobin,
    private readonly tasks: TasksService,
  ) {}

  async consider(
    account: { workspaceId: string },
    stored: readonly StoredInbound[],
  ): Promise<void> {
    const rows = stored.filter((row) => row.kind === "TEXT" && row.body?.trim());

    if (rows.length === 0) return;

    try {
      const workspace = await this.prisma.workspace.findUniqueOrThrow({
        where: { id: account.workspaceId },
        select: { ownerId: true },
      });
      const plan = await this.settings.plan(account.workspaceId);

      for (const row of rows) {
        // One unreadable message must not cost the rest of the delivery.
        try {
          await this.apply(account.workspaceId, workspace.ownerId, row, plan);
        } catch (error) {
          this.logger.error(
            `Could not classify a lead for workspace ${account.workspaceId}: ${reasonOf(error)}`,
          );
        }
      }
    } catch (error) {
      // The plan or the owner could not be read: there is nothing to apply,
      // and Meta must not be told to retry a message that is already stored.
      this.logger.error(
        `Could not read the routing plan for workspace ${account.workspaceId}: ${reasonOf(error)}`,
      );
    }
  }

  private async apply(
    workspaceId: string,
    ownerId: string,
    row: StoredInbound,
    plan: RoutingPlan,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      // The thread id came from a row the store already scoped, but a lookup
      // that names the tenant too cannot be talked into another workspace.
      where: { id: row.conversationId, workspaceId },
      select: {
        id: true,
        interest: true,
        interestScore: true,
        interestReason: true,
        interestAt: true,
        assignedToUserId: true,
        contactId: true,
        contact: { select: { tags: true, profileName: true, waId: true } },
      },
    });

    if (!conversation || conversation.contact === null) return;

    // A person's call outranks a rule for one day. The customer's next "ok"
    // must not undo it.
    const manualAt = conversation.interestReason === MANUAL_REASON ? conversation.interestAt : null;

    if (manualAt && Date.now() - manualAt.getTime() < MANUAL_FREEZE_MS) return;

    const previous = await this.prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        direction: "INBOUND",
        id: { not: row.messageId },
        body: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { body: true },
    });

    const verdict = classify(row.body ?? "", {
      stage: conversation.interest,
      score: conversation.interestScore,
      body: previous?.body ?? null,
      reason: conversation.interestReason,
    });

    const staged = await this.prisma.conversation.updateMany({
      where: {
        id: conversation.id,
        workspaceId,
        // Re-checked inside the statement: a manager's override can land while
        // the previous message is being read, and it must survive this write.
        OR: [
          { interestAt: null },
          { interestAt: { lt: new Date(Date.now() - MANUAL_FREEZE_MS) } },
          { interestReason: { not: MANUAL_REASON } },
        ],
      },
      data: {
        interest: verdict.interest,
        interestScore: verdict.score,
        interestReason: verdict.reason,
        interestAt: new Date(),
      },
    });

    // Nothing was staged, so the tags, the assignment and the errand all belong
    // to the decision that won the race.
    if (staged.count === 0) return;

    await this.prisma.contact.update({
      where: { id: conversation.contactId },
      data: { tags: tagsFor(conversation.contact.tags, verdict.interest) },
    });

    if (verdict.interest === "NOT_INTERESTED") {
      // The thread stays in the inbox as history; only the errand ends.
      await this.prisma.followUpTask.updateMany({
        where: { conversationId: conversation.id, status: "OPEN" },
        data: { status: "CANCELLED" },
      });

      return;
    }

    if (verdict.interest !== "INTERESTED") return;

    let assignee = conversation.assignedToUserId;

    if (!assignee && plan.autoAssign && plan.designation) {
      const picked = await this.robin.pick(workspaceId, plan.designation);

      if (picked) {
        // `assignedToUserId: null` makes a racing manual assignment win.
        const claimed = await this.prisma.conversation.updateMany({
          where: { id: conversation.id, assignedToUserId: null },
          data: { assignedToUserId: picked },
        });

        // Losing that race does not lose the errand: the task follows whoever
        // the conversation now belongs to, not the owner by default.
        assignee =
          claimed.count > 0
            ? picked
            : ((
                await this.prisma.conversation.findUnique({
                  where: { id: conversation.id, workspaceId },
                  select: { assignedToUserId: true },
                })
              )?.assignedToUserId ?? null);
      }
    }

    if (!plan.autoTask) return;

    const name = conversation.contact.profileName ?? conversation.contact.waId;

    const created = await this.tasks.create({
      workspaceId,
      conversationId: conversation.id,
      title: `Follow up with ${name}`,
      note: `Interested: ${verdict.reason === NO_SIGNAL ? "signals over time" : verdict.reason}`,
      dueAt: new Date(Date.now() + plan.taskDueHours * 60 * 60 * 1000),
      // Nobody to rotate to is not a reason to lose the errand: the owner
      // carries it, and the strip names them like anybody else.
      assignedToUserId: assignee ?? ownerId,
    });

    if (!created) return;

    // A manager's refusal can land between the stage write above and this
    // insert, and its own cancel then ran against a row that did not exist
    // yet. Re-reading the stage closes that order without a transaction: a
    // refusal that arrived while this pass was inserting takes the task with
    // it, and one arriving after this read cancels the task itself.
    const current = await this.prisma.conversation.findUnique({
      where: { id: conversation.id, workspaceId },
      select: { interest: true },
    });

    if (current?.interest !== "INTERESTED") {
      await this.prisma.followUpTask.updateMany({
        where: { id: created, status: "OPEN" },
        data: { status: "CANCELLED" },
      });
    }
  }
}
