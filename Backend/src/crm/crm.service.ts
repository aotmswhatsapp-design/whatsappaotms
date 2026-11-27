import { Injectable, NotFoundException } from "@nestjs/common";
import type { LeadInterest, Prisma } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { CONVERSATION_SELECT, conversationView, type ConversationView } from "../inbox/inbox.view";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { BOARD_COLUMNS, columnOf, type BoardColumn } from "./crm.pipeline";
import { MANUAL_REASON } from "./interest.rules";

export interface PipelineView {
  columns: { key: BoardColumn; label: string; rows: ConversationView[] }[];
  counts: Record<BoardColumn, number>;
  total: number;
}

/** A board of twenty leads is a board; a board of a thousand is a report. */
const BOARD_LIMIT = 200;

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async pipeline(claims: AuthClaims, interest?: LeadInterest): Promise<PipelineView> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const where: Prisma.ConversationWhereInput = { workspaceId };

    if (interest) where.interest = interest;

    const rows = await this.prisma.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: BOARD_LIMIT,
      select: CONVERSATION_SELECT,
    });

    const views = rows.map(conversationView);
    const buckets = new Map<BoardColumn, ConversationView[]>(
      BOARD_COLUMNS.map((column) => [column.key, []]),
    );

    for (const view of views) {
      buckets.get(columnOf(view))?.push(view);
    }

    const counts = Object.fromEntries(
      BOARD_COLUMNS.map((column) => [column.key, buckets.get(column.key)?.length ?? 0]),
    ) as Record<BoardColumn, number>;

    return {
      columns: BOARD_COLUMNS.map((column) => ({
        key: column.key,
        label: column.label,
        rows: buckets.get(column.key) ?? [],
      })),
      counts,
      total: views.length,
    };
  }

  /**
   * A manager's decision about one lead.
   *
   * `manual` is what stops intake reversing it for 24 hours: the customer's
   * next "ok" must not undo a person's call. A refusal also cancels the open
   * task, exactly as the classifier would.
   */
  async setInterest(
    claims: AuthClaims,
    conversationId: string,
    interest: LeadInterest,
  ): Promise<{ ok: true }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const updated = await this.prisma.conversation.updateMany({
      where: { id: conversationId, workspaceId },
      data: {
        interest,
        interestReason: MANUAL_REASON,
        interestAt: new Date(),
      },
    });

    if (updated.count === 0) {
      throw new NotFoundException({
        code: "CONVERSATION_MISSING",
        message: "Unknown conversation.",
      });
    }

    if (interest === "NOT_INTERESTED") {
      await this.prisma.followUpTask.updateMany({
        where: { conversationId, status: "OPEN" },
        data: { status: "CANCELLED" },
      });
    }

    return { ok: true };
  }
}
