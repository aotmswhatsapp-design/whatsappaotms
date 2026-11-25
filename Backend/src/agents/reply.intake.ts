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

    const agent = await this.prisma.agent.findFirst({
      where: { whatsappAccountId: account.id, isActive: true },
      select: { id: true },
    });

    // Without an active agent the message is still stored and still visible in
    // the Inbox. There is simply nobody to answer it.
    if (!agent) return 0;

    const created = await this.prisma.agentRun.createMany({
      data: answerable.map((row) => ({
        workspaceId: account.workspaceId,
        agentId: agent.id,
        kind: "REPLY" as const,
        conversationId: row.conversationId,
        inboundMessageId: row.messageId,
        status: "QUEUED" as const,
      })),
      skipDuplicates: true,
    });

    return created.count;
  }
}
