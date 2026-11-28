import {
  ConflictException,
  HttpException,
  Injectable,
  Optional,
} from "@nestjs/common";
import type { Agent } from "@prisma/client";

import { cardTurn, type CardTurn } from "../bots/bot.reply";
import type { BotFlow } from "../bots/bot.card";
import { ruleReply } from "../bots/bot.rules";
import { BotStore } from "../bots/bot.store";
import { InboxSender, type SendTarget } from "../inbox/inbox.sender";
import { windowOpen, type MessageView } from "../inbox/inbox.view";
import { PrismaService } from "../prisma/prisma.service";
import { AgentRouter } from "./agent.router";
import { OpenRouter } from "./ai.openrouter";
import { detectLanguage, type LanguageCode } from "./language.detect";
import { handoffLine, matchesEscalation } from "./reply.prompt";
import { RetrievalService } from "./retrieval.service";
import { answerFrom } from "./search/answer";

/**
 * When a claim is old enough to be treated as abandoned. Answering is now
 * local retrieval plus one HTTP send, so a claim this old is far more likely to
 * belong to a dead process than to one still working.
 */
const STALE_MS = 600_000;

/** After this many interruptions the run is left FAILED rather than looped. */
const MAX_ATTEMPTS = 2;

/**
 * How many of our own messages a tap is matched against.
 *
 * Deep enough for a long conversation — several cards, several answers between
 * them — and still one indexed read. A card older than this is found through
 * the flow itself, so the number bounds the work, not which taps work.
 */
const OUTBOUND_DEPTH = 50;

export interface ClaimedRun {
  id: string;
  workspaceId: string;
  agentId: string;
  conversationId: string | null;
  inboundMessageId: string | null;
}

/**
 * What one run has cost so far. Only wall-clock is recorded: answering is
 * local, so there is no vendor spend to attribute, and the token columns on
 * `agent_runs` keep their defaults.
 */
export interface RunUsage {
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
    private readonly store: BotStore,
    /** Absent on a deployment with no key: the extractive answer is the reply. */
    @Optional() private readonly ai?: OpenRouter,
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

    // The number's row survives a disconnect so the thread stays readable, but
    // its token does not. Answering through it is impossible, and failing here
    // keeps the run's record honest instead of letting the sender throw.
    const { account } = conversation;

    if (!account.accessTokenCipher) {
      await this.skip(run.id, "no-channel");
      return;
    }

    const target: SendTarget = {
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      waId: conversation.contact.waId,
      account: {
        phoneNumberId: account.phoneNumberId,
        graphVersion: account.graphVersion,
        accessTokenCipher: account.accessTokenCipher,
      },
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

    // Decided once, from the message itself, and carried into every line that
    // could be sent: the reply, and the handoff if there is to be one. A
    // customer who wrote Telugu is answered in Telugu or not at all — an
    // English apology is the same as no apology.
    const language = detectLanguage(question);

    // Who answers. A thread keeps the agent that already owns it — the common
    // path, and it asks nobody — and only a thread that is new, or whose agent
    // was switched off, is decided here. A question the word overlap settles
    // is decided by it; one it cannot is put to the model, which is the only
    // case where a model can read it better.
    const routing = await this.router.chooseSmart({
      whatsappAccountId: conversation.accountId,
      agentId: conversation.agentId,
      question,
    });

    if (!routing.agentId) {
      await this.skip(run.id, "no-agent");
      return;
    }

    let agent: Agent = row.agent;

    if (routing.agentId !== agent.id) {
      const next = await this.prisma.agent.findUnique({
        where: { id: routing.agentId },
      });

      if (!next) {
        await this.skip(run.id, "no-agent");
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
      await this.skip(run.id, "no-agent");
      return;
    }

    // The flow is read before the tap because the tap needs it: the id is looked
    // up in what we already sent, and — for a card that has scrolled past the
    // window we read — in the business's wording as it stands now.
    const flow = await this.flowOf(agent.id);

    // A tap is answered by the card it came from, not by a search for the words
    // printed on the button. This waits until after routing because a tap can
    // be the first thing a customer ever says — a template quick reply — and
    // then the thread still needs an agent. Anything the card does not claim —
    // "do you deliver?" typed under a menu — falls through to the answer below.
    //
    // Which card it came from is not decided by the newest message: a customer
    // can scroll back to a menu from last week and tap it, and that tap means
    // what it meant then.
    const turn = cardTurn({
      body: inbound?.body ?? null,
      payload: inbound?.payload ?? null,
      outbound: await this.sentPayloads(conversation.id),
      flow,
    });

    if (turn.kind !== "none") {
      await this.act(
        run.id,
        conversation.id,
        target,
        agent.id,
        turn,
        started,
        language.code,
      );
      return;
    }

    // After the cards, because a card's own action is the business's answer and
    // cannot be overruled by a keyword that happens to appear on its button: a
    // "Talk to staff" button hands off because its action says so, and a
    // "Pricing" button sends the price list even where "price" is a keyword. A
    // complaint typed under a menu still escalates. Before the model, because a
    // complaint must never depend on what a model decides to say about it.
    if (matchesEscalation(question, agent.escalateKeywords)) {
      await this.handoff(run.id, conversation.id, target, agent.id, "handoff", {
        language: language.code,
      });
      return;
    }

    // A keyword rule answers before the knowledge base is searched: the business
    // wrote both the trigger and the card, so the sentence is theirs and cannot
    // be contradicted by a retrieval miss. After the tap check on purpose — a
    // customer picking a button meant exactly that button, not a keyword.
    const ruled = flow ? ruleReply(flow, question) : null;

    if (flow && ruled) {
      await this.act(
        run.id,
        conversation.id,
        target,
        agent.id,
        { kind: "card", flow, card: ruled.card },
        started,
        language.code,
      );
      return;
    }

    try {
      // Cosmetic and already failure-tolerant; it must never stop a reply.
      await this.sender.typing(target);
    } catch {
      // ignore
    }

    // Set once the customer actually has the answer. A failure after this
    // point is bookkeeping, and must never become a handoff — the customer
    // would read a real reply followed by "I can't answer that".
    let delivered: string | null = null;

    try {
      const { chunks } = await this.retrieval.search(
        { agentId: agent.id, workspaceId: conversation.workspaceId },
        question,
      );

      // Two engines in one decision: the model writes the reply from the
      // material, and the business's own sentences answer when it cannot. Both
      // are cleaned, length-capped and link-stripped inside `answerFrom`, so
      // this call site never learns which one spoke — and never has to.
      const answer = await answerFrom({
        agent: {
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          maxReplyChars: agent.maxReplyChars,
        },
        question,
        chunks,
        language,
        chatter: this.ai,
      });

      // Neither engine found an answer: nothing was retrieved, or nothing in
      // it speaks to the question. One fixed line in the customer's own
      // language, a paused thread, and a place in the team's queue.
      if (!answer.ok) {
        await this.handoff(
          run.id,
          conversation.id,
          target,
          agent.id,
          "no-context",
          { usage: { latencyMs: Date.now() - started }, language: language.code },
        );
        return;
      }

      const sent = await this.sender.text({
        ...target,
        body: answer.body,
        quote: null,
        agentId: agent.id,
      });

      delivered = sent.id;

      await this.prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "SENT",
          outboundMessageId: sent.id,
          latencyMs: Date.now() - started,
          reason: null,
          error: null,
        },
      });
    } catch (error) {
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
            },
          })
          .catch(() => undefined);
        return;
      }

      // The window can close between the gate and the send.
      if (error instanceof ConflictException) {
        await this.skip(run.id, "window-closed", {
          latencyMs: Date.now() - started,
        });
        return;
      }

      // Nothing answered, so worse than a wrong answer would have been: the
      // customer gets the fixed line and the thread becomes a person's work.
      // The failure's sentence is kept on the run — that is the only place it
      // will be read.
      await this.handoff(
        run.id,
        conversation.id,
        target,
        agent.id,
        "unavailable",
        {
          usage: { latencyMs: Date.now() - started },
          note: sentenceOf(error),
          language: language.code,
        },
      );
    }
  }

  // History is no longer read here: an extractive answer has no prompt to
  // carry turns into. The conversation engine reads them for repeat detection
  // and for the selected menu, which is a different question from "what did
  // the customer say three messages ago".

  /**
   * The agent's flow as it is stored now, or null.
   *
   * Read here rather than carried on the run because it is the business's
   * current wording: a card edited five seconds ago is the one that should
   * answer. A database that cannot be read (a missing table, a dropped
   * connection) means "no flow" rather than a handoff — every caller has a way
   * to answer without one.
   */
  private async flowOf(agentId: string): Promise<BotFlow | null> {
    try {
      return await this.store.read(agentId);
    } catch {
      return null;
    }
  }

  /**
   * The payloads of what we sent, newest first.
   *
   * A tap answers the card it was drawn on, whenever that card arrived: a
   * customer who scrolls back to last week's menu and taps "Drinks" means what
   * they meant then. Each card leaves its flow and its own id behind, so a
   * bounded read finds it — and a card sent before the window still routes,
   * through the flow the caller passes in.
   *
   * A message that carries no snapshot — an answer, a handoff line, a location
   * — is skipped by the lookup rather than ending it.
   */
  private async sentPayloads(conversationId: string): Promise<unknown[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, direction: "OUTBOUND" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: OUTBOUND_DEPTH,
      select: { payload: true },
    });

    return rows.map((row) => row.payload);
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
    started: number,
    language: LanguageCode,
  ): Promise<void> {
    if (turn.kind === "handoff") {
      await this.handoff(runId, conversationId, target, agentId, "handoff", {
        usage: { latencyMs: Date.now() - started },
        language,
      });
      return;
    }

    try {
      // A card can leave as several messages — its pictures go first — but the
      // run records the card itself: that is the message the agent wrote and
      // the one a customer's tap will answer.
      const sent: MessageView =
        turn.kind === "say"
          ? await this.sender.text({
              ...target,
              body: turn.body,
              quote: null,
              agentId,
            })
          : (
              await this.sender.interactive({
                ...target,
                flow: turn.flow,
                card: turn.card,
                quote: null,
                agentId,
              })
            ).message;

      await this.prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: "SENT",
          outboundMessageId: sent.id,
          latencyMs: Date.now() - started,
          reason: null,
          error: null,
        },
      });
    } catch (error) {
      // The window can close between the gate above and this send.
      if (error instanceof ConflictException) {
        await this.skip(runId, "window-closed", {
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
        { usage: { latencyMs: Date.now() - started }, note: sentenceOf(error), language },
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
    options: {
      usage?: RunUsage;
      /** Why the AI could not answer, when it failed rather than found nothing. */
      note?: string;
      /** The customer's language, so the apology is in it. */
      language?: LanguageCode;
    } = {},
  ): Promise<void> {
    const { usage = {}, note, language } = options;

    await this.pause(conversationId, reason);

    try {
      const sent = await this.sender.text({
        ...target,
        body: handoffLine(language),
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
