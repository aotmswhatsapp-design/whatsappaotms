import { Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { DEFAULT_CHAT_MODEL, OpenAiProvider } from "./ai.openai";

/**
 * Which agent answers one thread, and what deciding it cost.
 *
 * `sticky` means the thread already had an active owner, so nothing was asked:
 * confirming an existing decision is the common case and it is free.
 */
export interface Routing {
  agentId: string | null;
  sticky: boolean;
  tokensIn?: number;
  tokensOut?: number;
}

/** A number with more candidates than this is a directory, not a routing task. */
const MAX_CANDIDATES = 12;

/** A description is a sentence. Anything longer is a prompt, not a hint. */
const MAX_DESCRIPTION = 400;

/** The classifier only needs the opening of a message to recognise its subject. */
const MAX_QUESTION = 1_000;

/**
 * One digit would do, but the gpt-5 family bills reasoning tokens before the
 * answer, and a budget of four came back empty against a real key.
 */
const MAX_TOKENS = 24;

/**
 * Picks the agent that answers a conversation.
 *
 * Three properties matter more than the choice itself:
 *
 * - A thread that already has an active owner is never re-routed, so two
 *   agents on one number cannot take turns inside a conversation.
 * - With one active agent there is no decision and no call, which is every
 *   workspace that has not deliberately split its work.
 * - Nothing here can stop a reply: no key, a provider error, a malformed
 *   answer or an out-of-range number all fall back to the oldest active agent,
 *   because answering from the wrong specialist costs one message and silence
 *   costs the customer.
 */
@Injectable()
export class AgentRouter {
  private readonly logger = new Logger(AgentRouter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: OpenAiProvider,
  ) {}

  async choose(input: {
    whatsappAccountId: string;
    /** The thread's current owner, if it has one. */
    agentId: string | null;
    question: string;
  }): Promise<Routing> {
    const agents = await this.prisma.agent.findMany({
      where: { whatsappAccountId: input.whatsappAccountId, isActive: true },
      orderBy: { createdAt: "asc" },
      take: MAX_CANDIDATES,
      select: { id: true, name: true, description: true },
    });

    // Nobody is on duty: the message stays in the Inbox for a person.
    if (agents.length === 0) return { agentId: null, sticky: false };

    // The owner still works here. One indexed read, no model call, and the
    // conversation keeps the voice it started with.
    if (input.agentId && agents.some((agent) => agent.id === input.agentId)) {
      return { agentId: input.agentId, sticky: true };
    }

    // One agent is not a choice — and `orderBy` already made it the oldest.
    if (agents.length === 1) return { agentId: agents[0].id, sticky: false };

    // Without a key the descriptions cannot be read. The oldest agent is
    // arbitrary but it is a reply, and the Inbox still shows who answered.
    if (!this.provider.configured) {
      return { agentId: agents[0].id, sticky: false };
    }

    try {
      const answer = await this.provider.chat({
        model: DEFAULT_CHAT_MODEL,
        system: [
          "You route customer messages at one business.",
          "Choose the single agent best suited to answer the customer's message.",
          "Answer with that agent's number and nothing else.",
        ].join(" "),
        // The candidates and the customer's words are both data here, and both
        // travel as one user turn: the system prompt never carries text a
        // customer wrote.
        messages: [
          {
            role: "user",
            content: `${candidates(agents)}\n\nCustomer message:\n${input.question.slice(0, MAX_QUESTION)}`,
          },
        ],
        temperature: 0,
        maxTokens: MAX_TOKENS,
      });

      const picked = ordinal(answer.text, agents.length);

      if (picked === null) {
        this.logger.warn(
          `Router answered ${JSON.stringify(answer.text.slice(0, 40))}, which names no agent; using the oldest.`,
        );

        return {
          agentId: agents[0].id,
          sticky: false,
          tokensIn: answer.tokensIn,
          tokensOut: answer.tokensOut,
        };
      }

      return {
        agentId: agents[picked].id,
        sticky: false,
        tokensIn: answer.tokensIn,
        tokensOut: answer.tokensOut,
      };
    } catch (error) {
      this.logger.warn(
        `Routing failed, answering from the oldest agent: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );

      return { agentId: agents[0].id, sticky: false };
    }
  }
}

/** Numbered, because a model transcribes a digit far more reliably than a uuid. */
function candidates(
  agents: { name: string; description: string | null }[],
): string {
  return agents
    .map((agent, index) => {
      const hint = (agent.description ?? "").trim().slice(0, MAX_DESCRIPTION);

      return `${index + 1}. ${agent.name}${hint ? ` — ${hint}` : ""}`;
    })
    .join("\n");
}

/** The 0-based position of the agent the model named, or null for none. */
function ordinal(text: string, count: number): number | null {
  const match = /\d+/.exec(text);
  if (!match) return null;

  const position = Number(match[0]) - 1;

  return position >= 0 && position < count ? position : null;
}
