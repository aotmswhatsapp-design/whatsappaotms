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

/**
 * When a claim is old enough to be treated as abandoned. One answering run can
 * spend six minutes inside the provider — retrieval embeds with three
 * 60-second attempts, then chat with three more — so a shorter window would
 * requeue a worker that is still alive and let two of them answer the same run.
 */
const STALE_MS = 600_000;

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
 * What one run has paid for so far. Written as each call returns rather than
 * at the end, so a run that fails after the spend still shows it.
 */
export interface RunUsage {
  tokensIn?: number;
  tokensOut?: number;
  embeddingTokens?: number;
  latencyMs?: number;
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
      select: { id: true, attempts: true, claimedAt: true },
    });

    let recovered = 0;

    for (const row of stale) {
      // Conditional on the exact claim that went stale: between the read above
      // and this write the sweep of another process can have requeued the row
      // and a worker can have claimed it again, and matching on `CLAIMED`
      // alone would drag that fresh claim back into the queue mid-answer.
      const result = await this.prisma.agentRun.updateMany({
        where: { id: row.id, status: "CLAIMED", claimedAt: row.claimedAt },
        data:
          row.attempts >= MAX_ATTEMPTS
            ? {
                status: "FAILED",
                error: "The reply was interrupted twice and will not be retried.",
              }
            : { status: "QUEUED", claimedAt: null, attempts: { increment: 1 } },
      });

      recovered += result.count;
    }

    return recovered;
  }

  /**
   * Never throws: the runner's only job is to keep ticking.
   *
   * `attempt` records a terminal status on every path it controls, but the
   * reads and early skips before it are unguarded — a rejected `findUnique`
   * would leave the run `CLAIMED` until the sweep, and the sweep is minutes
   * away. This boundary turns any such rejection into a recorded failure.
   */
  async answer(run: ClaimedRun): Promise<void> {
    try {
      await this.attempt(run);
    } catch (error) {
      await this.prisma.agentRun
        .update({
          where: { id: run.id },
          data: { status: "FAILED", error: sentenceOf(error) },
        })
        .catch(() => undefined);
    }
  }

  /** The gates, the model call and the send, in cheapest-first order. */
  private async attempt(run: ClaimedRun): Promise<void> {
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

    // A burst of three messages is one answer, for the last of them. A newer
    // sibling suppresses this run while it is waiting, being worked on, or
    // already answered — `SENT` included, or a newest message that finished
    // first would let every older sibling answer too. `FAILED` is left out, so
    // a newest run that failed does not suppress siblings that have not looked
    // yet — but a sibling that already skipped stays skipped, so the burst can
    // end up unanswered when the newest run fails after the others are done.
    // That is the vendor failing, which would have failed the older runs too.
    // The `id` tie-break covers one delivery whose rows share a `createdAt`.
    const newer = await this.prisma.agentRun.count({
      where: {
        conversationId: conversation.id,
        status: { in: ["QUEUED", "CLAIMED", "SENT"] },
        OR: [
          { createdAt: { gt: row.createdAt } },
          { createdAt: row.createdAt, id: { gt: row.id } },
        ],
      },
    });

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

    // Every paid call lands here the moment it returns, so a run that fails
    // after the spend — a refused send, an empty answer — still records what
    // it cost. `undefined` fields are left unwritten.
    const spent: RunUsage = {};

    try {
      const { chunks, embedTokens } = await this.retrieval.search(
        agent.id,
        question,
      );

      spent.embeddingTokens = embedTokens;

      if (chunks.length === 0) {
        await this.handoff(
          run.id,
          conversation.id,
          target,
          agent.id,
          "no-context",
          { ...spent, latencyMs: Date.now() - started },
        );
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
        messages: messagesOf(await this.turnsOf(conversation.id, question)),
        temperature: agent.temperature,
        maxTokens: MAX_TOKENS,
      });

      spent.tokensIn = answer.tokensIn;
      spent.tokensOut = answer.tokensOut;

      const body = cleanReply(answer.text, {
        maxChars: agent.maxReplyChars,
        context: chunks.map((chunk) => chunk.text).join("\n\n"),
      });

      if (!body) {
        await this.handoff(
          run.id,
          conversation.id,
          target,
          agent.id,
          "no-context",
          { ...spent, latencyMs: Date.now() - started },
        );
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
      // A call that failed after the vendor charged for it still carries its
      // tokens; the failing call's own count wins over whatever came before.
      if (error instanceof AiError) {
        if (error.usage.tokensIn !== undefined) spent.tokensIn = error.usage.tokensIn;
        if (error.usage.tokensOut !== undefined) spent.tokensOut = error.usage.tokensOut;
      }

      // The window can close between the gate and the send.
      if (error instanceof ConflictException) {
        await this.skip(run.id, "window-closed", {
          ...spent,
          latencyMs: Date.now() - started,
        });
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
          ...spent,
        },
      });
    }
  }

  /**
   * History plus the message being answered. History is `TEXT` only, but a
   * `BUTTON` or `INTERACTIVE` tap is queued as a question too, and a model
   * shown the material without that line answers something nobody asked.
   */
  private async turnsOf(
    conversationId: string,
    question: string,
  ): Promise<Turn[]> {
    const turns = await this.historyOf(conversationId);
    const last = turns[turns.length - 1];

    if (last?.role === "user" && last.body.trim() === question) return turns;

    return [...turns, { role: "user", body: question }];
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
    usage: RunUsage = {},
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
          ...usage,
        },
      });
    } catch (error) {
      // The reason still stands — a person has to answer — but the customer
      // never received the line, which is worth recording.
      await this.prisma.agentRun.update({
        where: { id: runId },
        data: { status: "SKIPPED", reason, error: sentenceOf(error), ...usage },
      });
    }
  }

  private async pause(conversationId: string, reason: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { aiPausedAt: new Date(), aiPauseReason: reason },
    });
  }

  private async skip(
    runId: string,
    reason: string,
    usage: RunUsage = {},
  ): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: { status: "SKIPPED", reason, ...usage },
    });
  }
}

function sentenceOf(error: unknown): string {
  if (error instanceof HttpException) return error.message;
  return error instanceof Error ? error.message : "The reply failed.";
}
