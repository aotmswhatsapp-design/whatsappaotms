import { Injectable } from "@nestjs/common";
import type { MessageKind } from "@prisma/client";

import type { StoredInbound } from "../inbox/inbox.store";
import { PrismaService } from "../prisma/prisma.service";

/**
 * What the model can be asked about. A photo, a document or a location is not
 * a question by itself, and a reaction is explicitly not one — the inbox
 * already refuses to count it as unread for the same reason.
 */
const ANSWERABLE = new Set<MessageKind>(["TEXT", "BUTTON", "INTERACTIVE"]);

/**
 * Turns a signed delivery into AI work.
 *
 * Nothing is answered here: this writes QUEUED rows and returns. `AgentsRunner`
 * claims them, so the two-second model call never happens on Meta's request —
 * a slow webhook is a webhook Meta retries.
 */
@Injectable()
export class ReplyIntake {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(
    account: { id: string; workspaceId: string },
    stored: StoredInbound[],
  ): Promise<number> {
    if (stored.length === 0) return 0;

    const answerable = stored.filter(
      (row) => ANSWERABLE.has(row.kind) && (row.body ?? "").trim().length > 0,
    );

    if (answerable.length === 0) return 0;

    // Who answers is decided in the worker, not here: choosing between several
    // active agents is a model call, and this runs inside Meta's request. The
    // thread's current owner is named on the run so it starts as the honest
    // guess; the oldest active agent is the placeholder for a thread nobody
    // owns yet, and the router overwrites both the run and the thread if it
    // picks someone else.
    const conversationIds = [...new Set(answerable.map((row) => row.conversationId))];

    const [conversations, agents] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { id: { in: conversationIds }, workspaceId: account.workspaceId },
        select: { id: true, agentId: true },
      }),
      this.prisma.agent.findMany({
        where: { whatsappAccountId: account.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, isActive: true },
      }),
    ]);

    const fallback = agents.find((agent) => agent.isActive)?.id ?? null;

    // Without an active agent the message is still stored and still visible in
    // the Inbox. There is simply nobody to answer it.
    if (!fallback) return 0;

    const owner = new Map(conversations.map((row) => [row.id, row.agentId]));

    const runs = answerable.flatMap((row) => {
      // A conversation the lookup did not return is one this delivery may not
      // touch; its message is still stored, it simply gets no answer here.
      if (!owner.has(row.conversationId)) return [];

      const agentId = owner.get(row.conversationId) ?? fallback;

      return [
        {
          workspaceId: account.workspaceId,
          agentId,
          kind: "REPLY" as const,
          conversationId: row.conversationId,
          inboundMessageId: row.messageId,
          status: "QUEUED" as const,
        },
      ];
    });

    if (runs.length === 0) return 0;

    const created = await this.prisma.agentRun.createMany({
      data: runs,
      skipDuplicates: true,
    });

    return created.count;
  }
}
