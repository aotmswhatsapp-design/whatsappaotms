import { ConflictException, HttpException, Injectable } from "@nestjs/common";
import type { Agent } from "@prisma/client";

import { InboxSender, type SendTarget } from "../inbox/inbox.sender";
import { windowOpen } from "../inbox/inbox.view";
import { PrismaService } from "../prisma/prisma.service";
import { AiError } from "./ai.errors";
import { OpenAiProvider } from "./ai.openai";
import {
  HANDOFF_MESSAGE,
  cleanReply,
  matchesEscalation,
  messagesOf,
  systemPrompt,
  type Turn,
} from "./reply.prompt";
import { RetrievalService } from "./retrieval.service";

/** A candidate a stuck process left behind is resumed, not lost. */
const STALE_MS = 90_000;

/** After this many interruptions the run is left FAILED rather than looped. */
const MAX_ATTEMPTS = 2;

/** The last few turns give the model the thread; older ones only cost tokens. */
const HISTORY_TURNS = 10;

/** One WhatsApp-sized answer. Not a setting: a longer one is not a reply. */
const MAX_TOKENS = 400;

export interface ClaimedRun {
  id: string;
  workspaceId: string;
  agentId: string;
  conversationId: string | null;
  inboundMessageId: string | null;
}

/**
 * Turns one queued run into one WhatsApp message, or into a recorded reason
 * why there is none.
 *
 * Every exit writes a terminal status, so the Activity tab can always say what
 * happened: `SENT`, or `SKIPPED` with `paused`, `superseded`, `window-closed`,
 * `no-agent`, `no-context` or `handoff`, or `FAILED` with the vendor's sentence.
 */
@Injectable()
export class ReplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: InboxSender,
    private readonly retrieval: RetrievalService,
    private readonly provider: OpenAiProvider,
  ) {}

  /**
   * One row at a time, atomically. `SKIP LOCKED` is what lets two ticks — or
   * two processes sharing the pooler — never claim the same run.
   */
  async claim(): Promise<ClaimedRun | null> {
    const rows = await this.prisma.$queryRaw<ClaimedRun[]>`
      UPDATE agent_runs
         SET status = 'CLAIMED', claimed_at = now()
       WHERE id = (
         SELECT id
           FROM agent_runs
          WHERE status = 'QUEUED'
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id,
                workspace_id        AS "workspaceId",
                agent_id            AS "agentId",
                conversation_id     AS "conversationId",
                inbound_message_id  AS "inboundMessageId"
    `;

    return rows[0] ?? null;
  }

  /** A claim older than the timeout means the process died mid-call. */
  async releaseStale(): Promise<number> {
    const stale = await this.prisma.agentRun.findMany({
      where: {
        status: "CLAIMED",
        claimedAt: { lt: new Date(Date.now() - STALE_MS) },
      },
      select: { id: true, attempts: true },
    });

    for (const row of stale) {
      await this.prisma.agentRun.update({
        where: { id: row.id },
        data:
          row.attempts >= MAX_ATTEMPTS
            ? {
                status: "FAILED",
                error: "The reply was interrupted twice and will not be retried.",
              }
            : { status: "QUEUED", claimedAt: null, attempts: { increment: 1 } },
      });
    }

    return stale.length;
  }

  /** Never throws: the runner's only job is to keep ticking. */
  async answer(run: ClaimedRun): Promise<void> {
    const started = Date.now();

    const row = await this.prisma.agentRun.findUnique({
      where: { id: run.id },
      include: { agent: true },
    });

    if (!row?.conversationId) {
      await this.skip(run.id, "no-agent");
      return;
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: row.conversationId },
      select: {
        id: true,
        workspaceId: true,
        aiPausedAt: true,
        lastInboundAt: true,
        contact: { select: { waId: true } },
        account: {
          select: {
            phoneNumberId: true,
            graphVersion: true,
            accessTokenCipher: true,
          },
        },
      },
    });

    if (!conversation) {
      await this.skip(run.id, "no-agent");
      return;
    }

    const target: SendTarget = {
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      waId: conversation.contact.waId,
      account: conversation.account,
    };

    const agent: Agent = row.agent;

    // Cheapest first: three of these are one column and a comparison.
    if (!agent.isActive) {
      await this.skip(run.id, "no-agent");
      return;
    }

    if (conversation.aiPausedAt) {
      await this.skip(run.id, "paused");
      return;
    }

    const newer = await this.prisma.agentRun.count({
      where: {
        conversationId: conversation.id,
        status: "QUEUED",
        createdAt: { gt: row.createdAt },
      },
    });

    // A burst of three messages is one answer, for the third.
    if (newer > 0) {
      await this.skip(run.id, "superseded");
      return;
    }

    if (!windowOpen(conversation.lastInboundAt)) {
      await this.skip(run.id, "window-closed");
      return;
    }

    const inbound = row.inboundMessageId
      ? await this.prisma.message.findUnique({
          where: { id: row.inboundMessageId },
          select: { body: true },
        })
      : null;

    const question = (inbound?.body ?? "").trim();

    if (!question) {
      await this.skip(run.id, "no-context");
      return;
    }

    // Before the model: a complaint must never depend on what a model decides
    // to say about it.
    if (matchesEscalation(question, agent.escalateKeywords)) {
      await this.handoff(run.id, conversation.id, target, agent.id, "handoff");
      return;
    }

    try {
      // Cosmetic and already failure-tolerant; it must never stop a reply.
      await this.sender.typing(target);
    } catch {
      // ignore
    }

    try {
      const { chunks, embedTokens } = await this.retrieval.search(
        agent.id,
        question,
      );

      if (chunks.length === 0) {
        await this.handoff(run.id, conversation.id, target, agent.id, "no-context");
        return;
      }

      const business = await this.prisma.businessProfile.findUnique({
        where: { workspaceId: conversation.workspaceId },
        select: { companyName: true },
      });

      const answer = await this.provider.chat({
        model: agent.model,
        system: systemPrompt({
          systemPrompt: agent.systemPrompt,
          companyName: business?.companyName ?? null,
          chunks,
          maxReplyChars: agent.maxReplyChars,
        }),
        messages: messagesOf(await this.historyOf(conversation.id)),
        temperature: agent.temperature,
        maxTokens: MAX_TOKENS,
      });

      const body = cleanReply(answer.text, {
        maxChars: agent.maxReplyChars,
        context: chunks.map((chunk) => chunk.text).join("\n\n"),
      });

      if (!body) {
        await this.handoff(run.id, conversation.id, target, agent.id, "no-context");
        return;
      }

      const sent = await this.sender.text({
        ...target,
        body,
        quote: null,
        agentId: agent.id,
      });

      await this.prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "SENT",
          outboundMessageId: sent.id,
          tokensIn: answer.tokensIn,
          tokensOut: answer.tokensOut,
          embeddingTokens: embedTokens,
          latencyMs: Date.now() - started,
          reason: null,
          error: null,
        },
      });
    } catch (error) {
      // The window can close between the gate and the send.
      if (error instanceof ConflictException) {
        await this.skip(run.id, "window-closed");
        return;
      }

      // A revoked key is a configuration fact, not a transient failure:
      // continuing to try spends money to learn nothing new.
      if (error instanceof AiError && error.code === "AI_UNAUTHORIZED") {
        await this.prisma.agent
          .update({ where: { id: agent.id }, data: { isActive: false } })
          .catch(() => undefined);
      }

      await this.prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          error: sentenceOf(error),
          latencyMs: Date.now() - started,
        },
      });
    }
  }

  /** The last few text turns, oldest first, with the customer as `user`. */
  private async historyOf(conversationId: string): Promise<Turn[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, kind: "TEXT", body: { not: null } },
      orderBy: { createdAt: "desc" },
      take: HISTORY_TURNS,
      select: { direction: true, body: true },
    });

    return rows
      .reverse()
      .map((row) => ({
        role: row.direction === "INBOUND" ? ("user" as const) : ("assistant" as const),
        body: row.body ?? "",
      }));
  }

  /**
   * One fixed line, then the thread is paused. A handoff is a success for the
   * customer even though the run is `SKIPPED`: nobody was answered wrongly.
   */
  private async handoff(
    runId: string,
    conversationId: string,
    target: SendTarget,
    agentId: string,
    reason: string,
  ): Promise<void> {
    await this.pause(conversationId, reason);

    try {
      const sent = await this.sender.text({
        ...target,
        body: HANDOFF_MESSAGE,
        quote: null,
        agentId,
      });

      await this.prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: "SKIPPED",
          reason,
          outboundMessageId: sent.id,
          error: null,
        },
      });
    } catch (error) {
      // The reason still stands — a person has to answer — but the customer
      // never received the line, which is worth recording.
      await this.prisma.agentRun.update({
        where: { id: runId },
        data: { status: "SKIPPED", reason, error: sentenceOf(error) },
      });
    }
  }

  private async pause(conversationId: string, reason: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { aiPausedAt: new Date(), aiPauseReason: reason },
    });
  }

  private async skip(runId: string, reason: string): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: { status: "SKIPPED", reason },
    });
  }
}

function sentenceOf(error: unknown): string {
  if (error instanceof HttpException) return error.message;
  return error instanceof Error ? error.message : "The reply failed.";
}
