import { ConflictException, HttpException, Injectable } from "@nestjs/common";
import type { Agent } from "@prisma/client";

import { cardTurn, type CardTurn } from "../bots/bot.reply";
import { InboxSender, type SendTarget } from "../inbox/inbox.sender";
import { windowOpen } from "../inbox/inbox.view";
import { PrismaService } from "../prisma/prisma.service";
import { AgentRouter } from "./agent.router";
import { AiError } from "./ai.errors";
import { HANDOFF_MESSAGE, cleanReply, matchesEscalation } from "./reply.prompt";
import { RetrievalService } from "./retrieval.service";
import { composeAnswer } from "./search/compose";

/**
 * When a claim is old enough to be treated as abandoned. One answering run can
 * spend six minutes inside the provider — retrieval embeds with three
 * 60-second attempts, then chat with three more — so a shorter window would
 * requeue a worker that is still alive and let two of them answer the same run.
 */
const STALE_MS = 600_000;

/** After this many interruptions the run is left FAILED rather than looped. */
const MAX_ATTEMPTS = 2;

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
 * `no-agent`, `no-context`, `handoff` or `unavailable`. `FAILED` is left for a
 * run that could not be attempted at all — a failure while answering is a
 * handoff, because the customer is owed a person rather than silence.
 */
@Injectable()
export class ReplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: InboxSender,
    private readonly retrieval: RetrievalService,
    private readonly router: AgentRouter,
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
        accountId: true,
        agentId: true,
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

    // Cheapest first: two of these are one column and a comparison. The agent
    // gate is not one of them — who answers is decided below, and a run queued
    // with an agent that has since been switched off can still be routed to
    // one that is answering.
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
          select: { body: true, payload: true },
        })
      : null;

    const question = (inbound?.body ?? "").trim();

    if (!question) {
      await this.skip(run.id, "no-context");
      return;
    }

    // Who answers. A thread keeps the agent that already owns it — the common
    // path, and it asks nobody — and only a thread that is new, or whose agent
    // was switched off, is decided here. The decision waits until now because
    // it can cost a model call, and the webhook must never wait for one.
    const routing = await this.router.choose({
      whatsappAccountId: conversation.accountId,
      agentId: conversation.agentId,
      question,
    });

    // What routing cost travels with every terminal status below: an attempt
    // that skips or fails still spent it.
    const routed: RunUsage = {};
    if (routing.tokensIn !== undefined) routed.tokensIn = routing.tokensIn;
    if (routing.tokensOut !== undefined) routed.tokensOut = routing.tokensOut;

    if (!routing.agentId) {
      await this.skip(run.id, "no-agent", routed);
      return;
    }

    let agent: Agent = row.agent;

    if (routing.agentId !== agent.id) {
      const next = await this.prisma.agent.findUnique({
        where: { id: routing.agentId },
      });

      if (!next) {
        await this.skip(run.id, "no-agent", routed);
        return;
      }

      agent = next;

      // The run records the agent that answered, not the one it was queued
      // with: the Activity tab is the record of what actually happened.
      await this.prisma.agentRun
        .update({ where: { id: run.id }, data: { agentId: next.id } })
        .catch(() => undefined);
    }

    // Bind the thread, but never over another answer's decision: the write is
    // conditional on the owner this attempt read, so a concurrent first reply
    // cannot be overwritten by a later one.
    if (conversation.agentId !== agent.id) {
      await this.prisma.conversation
        .updateMany({
          where: { id: conversation.id, agentId: conversation.agentId },
          data: { agentId: agent.id },
        })
        .catch(() => undefined);
    }

    // The router only names active agents, but one can still be switched off
    // between its read and this line.
    if (!agent.isActive) {
      await this.skip(run.id, "no-agent", routed);
      return;
    }

    // Before the model: a complaint must never depend on what a model decides
    // to say about it.
    if (matchesEscalation(question, agent.escalateKeywords)) {
      await this.handoff(
        run.id,
        conversation.id,
        target,
        agent.id,
        "handoff",
        routed,
      );
      return;
    }

    // A tap is answered by the card it came from, not by a search for the words
    // printed on the button. This waits until after routing because a tap can
    // be the first thing a customer ever says — a template quick reply — and
    // then the thread still needs an agent. Anything the card does not claim —
    // "do you deliver?" typed under a menu — falls through to the answer below.
    const turn = cardTurn({
      body: inbound?.body ?? null,
      payload: inbound?.payload ?? null,
      lastOutbound: await this.lastOutbound(conversation.id),
    });

    if (turn.kind !== "none") {
      await this.act(run.id, conversation.id, target, agent.id, turn, routed, started);
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
    const spent: RunUsage = { ...routed };

    // Set once the customer actually has the answer. A failure after this
    // point is bookkeeping, and must never become a handoff — the customer
    // would read a real reply followed by "I can't answer that".
    let delivered: string | null = null;

    try {
      const { chunks, embedTokens } = await this.retrieval.search(
        { agentId: agent.id, workspaceId: conversation.workspaceId },
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

      // The answer is a sentence from the material, not a sentence about it.
      // Nothing here can invent a price, a policy or a web address: every
      // character of the reply was written by the business and stored in a
      // chunk.
      const composed = composeAnswer({
        question,
        chunks,
        maxChars: agent.maxReplyChars,
      });

      // No sentence in the material shared a word with the question. That is
      // the same situation the prompt used to express as `[handoff]`, and it
      // is handled the same way: one fixed line, a paused thread, and a place
      // in the team's queue.
      if (!composed) {
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

      const body = cleanReply(composed.body, {
        maxChars: agent.maxReplyChars,
        context: composed.used.map((chunk) => chunk.text).join("\n\n"),
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

      delivered = sent.id;

      await this.prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "SENT",
          outboundMessageId: sent.id,
          ...spent,
          latencyMs: Date.now() - started,
          reason: null,
          error: null,
        },
      });
    } catch (error) {
      // A call that failed after the vendor charged for it still carries its
      // tokens; the failing call's own count wins over whatever came before.
      if (error instanceof AiError) {
        if (error.usage.tokensIn !== undefined)
          spent.tokensIn = error.usage.tokensIn + (routed.tokensIn ?? 0);
        if (error.usage.tokensOut !== undefined)
          spent.tokensOut = error.usage.tokensOut + (routed.tokensOut ?? 0);
      }

      // The reply is already in the customer's thread. Record that it went out
      // and why the write failed, rather than sending a second, contradictory
      // message as a handoff.
      if (delivered) {
        await this.prisma.agentRun
          .update({
            where: { id: run.id },
            data: {
              status: "SENT",
              outboundMessageId: delivered,
              error: sentenceOf(error),
              latencyMs: Date.now() - started,
              ...spent,
            },
          })
          .catch(() => undefined);
        return;
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

      // Nothing answered, so worse than a wrong answer would have been: the
      // customer gets the fixed line and the thread becomes a person's work.
      // The vendor's sentence is kept on the run — that is the only place it
      // will be read.
      await this.handoff(
        run.id,
        conversation.id,
        target,
        agent.id,
        "unavailable",
        { ...spent, latencyMs: Date.now() - started },
        sentenceOf(error),
      );
    }
  }

  // History is no longer read here: an extractive answer has no prompt to
  // carry turns into. The conversation engine reads them for repeat detection
  // and for the selected menu, which is a different question from "what did
  // the customer say three messages ago".

  /**
   * The newest thing we sent, because a tap answers what is on the customer's
   * screen. A reply that arrived after the card — an answer, a handoff line —
   * matches no card and leaves the message to be answered normally, which is
   * the right reading: the menu is no longer the last thing they were shown.
   */
  private async lastOutbound(conversationId: string): Promise<unknown> {
    const row = await this.prisma.message.findFirst({
      where: { conversationId, direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });

    return row?.payload ?? null;
  }

  /**
   * The effect of a tap. Every branch ends the run: a sentence and a card are
   * `SENT`, a handoff is `SKIPPED` with the thread paused.
   *
   * A refused send becomes a handoff rather than silence — Meta rejecting a
   * card means the customer's tap went nowhere, which is a person's problem to
   * pick up, exactly like a failed answer.
   */
  private async act(
    runId: string,
    conversationId: string,
    target: SendTarget,
    agentId: string,
    turn: Exclude<CardTurn, { kind: "none" }>,
    usage: RunUsage,
    started: number,
  ): Promise<void> {
    if (turn.kind === "handoff") {
      await this.handoff(runId, conversationId, target, agentId, "handoff", {
        ...usage,
        latencyMs: Date.now() - started,
      });
      return;
    }

    try {
      const sent =
        turn.kind === "say"
          ? await this.sender.text({
              ...target,
              body: turn.body,
              quote: null,
              agentId,
            })
          : await this.sender.interactive({
              ...target,
              flow: turn.flow,
              card: turn.card,
              quote: null,
              agentId,
            });

      await this.prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: "SENT",
          outboundMessageId: sent.id,
          ...usage,
          latencyMs: Date.now() - started,
          reason: null,
          error: null,
        },
      });
    } catch (error) {
      // The window can close between the gate above and this send.
      if (error instanceof ConflictException) {
        await this.skip(runId, "window-closed", {
          ...usage,
          latencyMs: Date.now() - started,
        });
        return;
      }

      await this.handoff(
        runId,
        conversationId,
        target,
        agentId,
        "unavailable",
        { ...usage, latencyMs: Date.now() - started },
        sentenceOf(error),
      );
    }
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
    /** Why the AI could not answer, when it failed rather than found nothing. */
    note?: string,
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
          error: note ?? null,
          ...usage,
        },
      });
    } catch (error) {
      // The reason still stands — a person has to answer — but the customer
      // never received the line, which is worth recording.
      await this.prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: "SKIPPED",
          reason,
          error: note ? `${note}; ${sentenceOf(error)}` : sentenceOf(error),
          ...usage,
        },
      });
    }
  }

  /**
   * A handoff is a person's work now, so the thread also moves to PENDING —
   * that is the filter a team works from, and the AI-paused chip alone assumes
   * somebody is scanning every open conversation. Resuming does not move it
   * back: a human turned the agent on again and keeps whatever status they set.
   */
  private async pause(conversationId: string, reason: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        aiPausedAt: new Date(),
        aiPauseReason: reason,
        status: "PENDING",
      },
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
