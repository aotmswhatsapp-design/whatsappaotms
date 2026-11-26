import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { AgentRunKind, AgentRunStatus } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { defaultAccount } from "../whatsapp/default-account";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { MediaStorage } from "../inbox/media.storage";
import { AiError } from "./ai.errors";
import { DEFAULT_CHAT_MODEL, OpenAiProvider } from "./ai.openai";
import type { AskAgentDto } from "./dto/ask-agent.dto";
import type { CreateAgentDto } from "./dto/create-agent.dto";
import type { ListRunsDto } from "./dto/list-runs.dto";
import type { UpdateAgentDto } from "./dto/update-agent.dto";
import { KnowledgeService, sourceView, type SourceView } from "./knowledge.service";
import { RetrievalService } from "./retrieval.service";
import {
  HANDOFF_MESSAGE,
  cleanReply,
  declined,
  messagesOf,
  systemPrompt,
} from "./reply.prompt";

/** What a draft starts with, so an agent is usable before it is tuned. */
const DEFAULT_PROMPT =
  "You answer customer questions for this business in WhatsApp. Be brief, warm and specific.";

export interface AgentList {
  agents: AgentView[];
  /** The number every agent on this screen answers on. Null before one is connected. */
  channel: { display: string | null; phoneNumberId: string } | null;
}

export interface AgentView {
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxReplyChars: number;
  escalateKeywords: string[];
  isActive: boolean;
  sourceCount: number;
  readySourceCount: number;
  createdAt: string;
}

export interface RunView {
  id: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  reason: string | null;
  conversationId: string | null;
  tokensIn: number;
  tokensOut: number;
  embeddingTokens: number;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
}

export interface Usage {
  runs: number;
  tokensIn: number;
  tokensOut: number;
  embeddingTokens: number;
}

export interface AgentDetail {
  agent: AgentView;
  sources: SourceView[];
  usage: Usage;
  runs: RunView[];
}

export interface AskResult {
  answer: string;
  citations: { sourceId: string; title: string; score: number; text: string }[];
  tokens: { input: number; output: number; embedding: number };
  reason: string | null;
}

/**
 * The agent's own surface: what it is, whether it answers, and what it costs.
 *
 * Activation is a transaction because "one active per number" is two writes —
 * deactivate the sibling, activate this one — and the partial unique index
 * would refuse the second if the first had not happened.
 */
@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly knowledge: KnowledgeService,
    private readonly retrieval: RetrievalService,
    private readonly provider: OpenAiProvider,
    private readonly media: MediaStorage,
  ) {}

  async list(claims: AuthClaims): Promise<AgentList> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    // The number travels with the list because the screen's header names it,
    // and a second request for it would be a second tenant lookup that could
    // disagree with this one.
    const [rows, account] = await Promise.all([
      this.prisma.agent.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { sources: true } } },
      }),
      defaultAccount(this.prisma, workspaceId, {
        displayPhoneNumber: true,
        phoneNumberId: true,
      }),
    ]);

    const ready = await this.prisma.knowledgeSource.groupBy({
      by: ["agentId"],
      where: { agentId: { in: rows.map((row) => row.id) }, status: "READY" },
      _count: { _all: true },
    });

    const index = new Map(ready.map((row) => [row.agentId, row._count._all]));

    return {
      agents: rows.map((row) => agentView(row, index.get(row.id) ?? 0)),
      channel: account
        ? { display: account.displayPhoneNumber, phoneNumberId: account.phoneNumberId }
        : null,
    };
  }

  async create(claims: AuthClaims, dto: CreateAgentDto): Promise<{ agent: AgentView }> {
    const { workspaceId, userId } = await this.workspaces.primaryFor(claims);

    const account = await defaultAccount(this.prisma, workspaceId, { id: true });

    if (!account) {
      throw new ConflictException({
        code: "NO_CHANNEL",
        message: "Connect a WhatsApp number before creating an agent.",
      });
    }

    const row = await this.prisma.agent.create({
      data: {
        workspaceId,
        whatsappAccountId: account.id,
        name: dto.name,
        description: dto.description ?? null,
        systemPrompt: dto.systemPrompt ?? DEFAULT_PROMPT,
        model: dto.model ?? DEFAULT_CHAT_MODEL,
        temperature: dto.temperature ?? 0.4,
        maxReplyChars: dto.maxReplyChars ?? 900,
        escalateKeywords: dto.escalateKeywords ?? [],
        createdByUserId: userId,
      },
      include: { _count: { select: { sources: true } } },
    });

    return { agent: agentView(row, 0) };
  }

  async detail(claims: AuthClaims, id: string): Promise<AgentDetail> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const agent = await this.knowledge.agentOf(workspaceId, id);

    // `agentOf` selects what most callers need; the detail screen needs the
    // whole row, so it is read again rather than widened for everyone.
    const [row, sources, totals, runs, ready] = await Promise.all([
      this.prisma.agent.findUniqueOrThrow({ where: { id: agent.id } }),
      this.prisma.knowledgeSource.findMany({
        where: { agentId: agent.id },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.agentRun.aggregate({
        where: { agentId: agent.id },
        _count: { _all: true },
        _sum: { tokensIn: true, tokensOut: true, embeddingTokens: true },
      }),
      this.prisma.agentRun.findMany({
        where: { agentId: agent.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      this.prisma.knowledgeSource.count({ where: { agentId: agent.id, status: "READY" } }),
    ]);

    return {
      agent: agentView({ ...row, _count: { sources: sources.length } }, ready),
      sources: sources.map(sourceView),
      usage: usageOf(totals),
      runs: runs.map(runView),
    };
  }

  async update(
    claims: AuthClaims,
    id: string,
    dto: UpdateAgentDto,
  ): Promise<{ agent: AgentView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const agent = await this.knowledge.agentOf(workspaceId, id);

    // Activation is its own route: a PATCH that could activate would bypass
    // the "one READY source" rule.
    const { isActive: _ignored, ...changes } = dto;

    // Clearing the description of an agent that is already on duty beside
    // another one would leave the router with nothing to tell them apart, so
    // the rule activation enforces also applies to the edit that removes it.
    if (agent.isActive && changes.description !== undefined) {
      await this.requireDescription(agent, changes.description);
    }

    const row = await this.prisma.agent.update({
      where: { id: agent.id },
      data: {
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {}),
        ...(changes.systemPrompt !== undefined ? { systemPrompt: changes.systemPrompt } : {}),
        ...(changes.model !== undefined ? { model: changes.model } : {}),
        ...(changes.temperature !== undefined ? { temperature: changes.temperature } : {}),
        ...(changes.maxReplyChars !== undefined ? { maxReplyChars: changes.maxReplyChars } : {}),
        ...(changes.escalateKeywords !== undefined
          ? { escalateKeywords: changes.escalateKeywords }
          : {}),
      },
      include: { _count: { select: { sources: true } } },
    });

    const ready = await this.prisma.knowledgeSource.count({
      where: { agentId: agent.id, status: "READY" },
    });

    return { agent: agentView(row, ready) };
  }

  async remove(claims: AuthClaims, id: string): Promise<{ deleted: true }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const agent = await this.knowledge.agentOf(workspaceId, id);

    const stored = await this.prisma.knowledgeSource.findMany({
      where: { agentId: agent.id, storagePath: { not: null } },
      select: { storagePath: true },
    });

    // Sources and runs go with the agent; the conversations it answered stay,
    // and `Message.agentId` is set null by the foreign key.
    await this.prisma.agent.delete({ where: { id: agent.id } });

    await this.storageRemove(stored.map((row) => row.storagePath).filter((path): path is string => path !== null));

    return { deleted: true };
  }

  async activate(claims: AuthClaims, id: string): Promise<{ agent: AgentView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const agent = await this.knowledge.agentOf(workspaceId, id);

    const ready = await this.prisma.knowledgeSource.count({
      where: { agentId: agent.id, status: "READY" },
    });

    if (ready === 0) {
      throw new ConflictException({
        code: "AGENT_UNTRAINED",
        message:
          "Add at least one source and wait for it to finish indexing before activating this agent.",
      });
    }

    // Several agents may work one number: a new thread is routed to the one
    // whose description fits it, and keeps that one.
    await this.requireDescription(agent, agent.description);

    await this.prisma.agent.update({
      where: { id: agent.id },
      data: { isActive: true },
    });

    const row = await this.prisma.agent.findUniqueOrThrow({
      where: { id: agent.id },
      include: { _count: { select: { sources: true } } },
    });

    return { agent: agentView(row, ready) };
  }

  /**
   * The switch's off position. A single update, not the two writes activation
   * needs: turning off can never violate the partial unique index.
   */
  async deactivate(claims: AuthClaims, id: string): Promise<{ agent: AgentView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const agent = await this.knowledge.agentOf(workspaceId, id);

    await this.prisma.agent.update({
      where: { id: agent.id },
      data: { isActive: false },
    });

    const ready = await this.prisma.knowledgeSource.count({
      where: { agentId: agent.id, status: "READY" },
    });

    const row = await this.prisma.agent.findUniqueOrThrow({
      where: { id: agent.id },
      include: { _count: { select: { sources: true } } },
    });

    return { agent: agentView(row, ready) };
  }

  /**
   * The playground. Nothing is sent, but the call is a run, so it is metered
   * and it appears in Activity beside the replies.
   */
  async ask(claims: AuthClaims, id: string, dto: AskAgentDto): Promise<AskResult> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const agent = await this.knowledge.agentOf(workspaceId, id);

    this.requireProvider();

    const started = Date.now();
    let embedTokens = 0;

    // Retrieval embeds the question, so it fails the same ways the chat call
    // does: inside the guard, where the error is mapped and the run is metered.
    try {
      const found = await this.retrieval.search(
        { agentId: agent.id, workspaceId },
        dto.question,
      );
      const chunks = found.chunks;
      embedTokens = found.embedTokens;

      if (chunks.length === 0) {
        await this.record(agent.id, workspaceId, "SKIPPED", "no-context", {
          embeddingTokens: embedTokens,
          latencyMs: Date.now() - started,
        });

        return {
          answer: HANDOFF_MESSAGE,
          citations: [],
          tokens: { input: 0, output: 0, embedding: embedTokens },
          reason: "no-context",
        };
      }

      const company = await this.prisma.businessProfile.findFirst({
        where: { workspaceId },
        select: { companyName: true },
      });

      const full = await this.prisma.agent.findUniqueOrThrow({
        where: { id: agent.id },
        select: { systemPrompt: true, temperature: true, maxReplyChars: true, model: true },
      });

      const result = await this.provider.chat({
        model: full.model,
        system: systemPrompt({
          systemPrompt: full.systemPrompt,
          companyName: company?.companyName ?? null,
          chunks,
          maxReplyChars: full.maxReplyChars,
        }),
        messages: messagesOf([{ role: "user", body: dto.question }]),
        temperature: full.temperature,
        maxTokens: 400,
      });

      const citations = chunks.map((chunk) => ({
        sourceId: chunk.sourceId,
        title: chunk.title,
        score: Math.round(chunk.score * 1000) / 1000,
        text: chunk.text.slice(0, 400),
      }));
      const tokens = {
        input: result.tokensIn,
        output: result.tokensOut,
        embedding: embedTokens,
      };

      // The prompt answers `[handoff]` when the material does not cover the
      // question. The playground has no thread to hand to a person, so it shows
      // the fixed line and records the same reason a real reply would.
      if (declined(result.text)) {
        await this.record(agent.id, workspaceId, "SKIPPED", "no-context", {
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          embeddingTokens: embedTokens,
          latencyMs: Date.now() - started,
        });

        return { answer: HANDOFF_MESSAGE, citations, tokens, reason: "no-context" };
      }

      const answer = cleanReply(result.text, {
        maxChars: full.maxReplyChars,
        context: chunks.map((chunk) => chunk.text).join("\n\n"),
      });

      await this.record(agent.id, workspaceId, "SENT", null, {
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        embeddingTokens: embedTokens,
        latencyMs: Date.now() - started,
      });

      return { answer, citations, tokens, reason: null };
    } catch (error) {
      await this.recordFailure(agent.id, workspaceId, {
        embeddingTokens: embedTokens,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : "The model call failed.",
      });

      this.toHttp(error);
    }
  }

  async runs(claims: AuthClaims, id: string, query: ListRunsDto): Promise<{
    runs: RunView[];
    nextCursor: string | null;
    usage: Usage;
  }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const agent = await this.knowledge.agentOf(workspaceId, id);
    const limit = query.limit ?? 30;

    // One `where` for the page and for the totals: the number above the table
    // always describes the rows the table can show, even when a cursor has
    // only fetched the first of them.
    const where = {
      agentId: agent.id,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, totals] = await Promise.all([
      this.prisma.agentRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.prisma.agentRun.aggregate({
        where,
        _count: { _all: true },
        _sum: { tokensIn: true, tokensOut: true, embeddingTokens: true },
      }),
    ]);

    const page = rows.slice(0, limit);

    return {
      runs: page.map(runView),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
      usage: usageOf(totals),
    };
  }

  /** A human pause, kept in the same three columns the takeover rule writes. */
  async pauseConversation(
    claims: AuthClaims,
    conversationId: string,
    reason: string,
  ): Promise<{ paused: true }> {
    const { workspaceId, userId } = await this.workspaces.primaryFor(claims);

    const updated = await this.prisma.conversation.updateMany({
      where: { id: conversationId, workspaceId },
      data: {
        aiPausedAt: new Date(),
        aiPausedByUserId: userId,
        aiPauseReason: reason,
      },
    });

    if (updated.count === 0) {
      throw new NotFoundException("That conversation does not exist.");
    }

    return { paused: true };
  }

  async resumeConversation(
    claims: AuthClaims,
    conversationId: string,
  ): Promise<{ paused: false }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const updated = await this.prisma.conversation.updateMany({
      where: { id: conversationId, workspaceId },
      data: { aiPausedAt: null, aiPausedByUserId: null, aiPauseReason: null },
    });

    if (updated.count === 0) {
      throw new NotFoundException("That conversation does not exist.");
    }

    return { paused: false };
  }

  /**
   * A second agent on duty needs a description: it is the only thing the
   * router can match a message against, and two undescribed agents would be
   * chosen between at random.
   */
  private async requireDescription(
    agent: { id: string; whatsappAccountId: string },
    description: string | null,
  ): Promise<void> {
    if (description?.trim()) return;

    const onDuty = await this.prisma.agent.count({
      where: {
        whatsappAccountId: agent.whatsappAccountId,
        isActive: true,
        id: { not: agent.id },
      },
    });

    if (onDuty === 0) return;

    throw new ConflictException({
      code: "AGENT_UNDESCRIBED",
      message:
        "Describe what this agent handles before it shares a number with another one — that description is how new conversations are routed.",
    });
  }

  private requireProvider(): void {
    if (!this.provider.configured) {
      throw new ServiceUnavailableException({
        code: "AI_NOT_CONFIGURED",
        message: "AI is not configured. Set OPENAI_API_KEY on the API and restart it.",
      });
    }
  }

  private async record(
    agentId: string,
    workspaceId: string,
    status: AgentRunStatus,
    reason: string | null,
    numbers: {
      tokensIn?: number;
      tokensOut?: number;
      embeddingTokens?: number;
      latencyMs?: number;
      error?: string;
    },
  ): Promise<void> {
    await this.prisma.agentRun.create({
      data: {
        workspaceId,
        agentId,
        kind: "PLAYGROUND",
        status,
        reason,
        tokensIn: numbers.tokensIn ?? 0,
        tokensOut: numbers.tokensOut ?? 0,
        embeddingTokens: numbers.embeddingTokens ?? 0,
        latencyMs: numbers.latencyMs ?? null,
        error: numbers.error ?? null,
      },
    });
  }

  /**
   * A run that has to be recorded, on a path that is already failing: an
   * insert that rejects must not replace the provider error the caller needs.
   */
  private async recordFailure(
    agentId: string,
    workspaceId: string,
    numbers: { embeddingTokens: number; latencyMs: number; error: string },
  ): Promise<void> {
    try {
      await this.record(agentId, workspaceId, "FAILED", null, numbers);
    } catch (failure) {
      this.logger.warn(
        `Could not record the failed run for agent ${agentId}: ${failure instanceof Error ? failure.message : "unknown error"}`,
      );
    }
  }

  /** `MediaStorage` is injected by the module; this keeps the call site short. */
  private storageRemove(paths: string[]): Promise<void> {
    return this.media.remove(paths);
  }

  private toHttp(error: unknown): never {
    if (error instanceof AiError) {
      const body = { code: error.code, message: error.message };

      if (error.code === "AI_NOT_CONFIGURED" || error.code === "AI_UNAUTHORIZED") {
        throw new ServiceUnavailableException(body);
      }

      if (error.code === "AI_RATE_LIMITED") throw new ConflictException(body);

      throw new BadGatewayException(body);
    }

    throw error;
  }
}

function agentView(
  row: {
    id: string;
    name: string;
    description: string | null;
    systemPrompt: string;
    model: string;
    temperature: number;
    maxReplyChars: number;
    escalateKeywords: string[];
    isActive: boolean;
    createdAt: Date;
    _count: { sources: number };
  },
  readySourceCount: number,
): AgentView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.systemPrompt,
    model: row.model,
    temperature: row.temperature,
    maxReplyChars: row.maxReplyChars,
    escalateKeywords: row.escalateKeywords,
    isActive: row.isActive,
    sourceCount: row._count.sources,
    readySourceCount,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The four numbers every response that reports token totals carries. Tracked,
 * never enforced: a cap would need a period to cap over, and the spec defers
 * that to the cost phase.
 */
function usageOf(totals: {
  _count: { _all: number };
  _sum: {
    tokensIn: number | null;
    tokensOut: number | null;
    embeddingTokens: number | null;
  };
}): Usage {
  return {
    runs: totals._count._all,
    tokensIn: totals._sum.tokensIn ?? 0,
    tokensOut: totals._sum.tokensOut ?? 0,
    embeddingTokens: totals._sum.embeddingTokens ?? 0,
  };
}

function runView(row: {
  id: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  reason: string | null;
  conversationId: string | null;
  tokensIn: number;
  tokensOut: number;
  embeddingTokens: number;
  latencyMs: number | null;
  error: string | null;
  createdAt: Date;
}): RunView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    reason: row.reason,
    conversationId: row.conversationId,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    embeddingTokens: row.embeddingTokens,
    latencyMs: row.latencyMs,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}
