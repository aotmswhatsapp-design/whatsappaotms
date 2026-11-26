import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { normalize, tokensOf } from "./search/normalize";

/**
 * Which agent answers one thread.
 *
 * `sticky` means the thread already had an active owner, so nothing was
 * compared: confirming an existing decision is the common case and it is free.
 */
export interface Routing {
  agentId: string | null;
  sticky: boolean;
}

/** A number with more candidates than this is a directory, not a routing task. */
const MAX_CANDIDATES = 12;

/** A description is a sentence. Anything longer is a prompt, not a hint. */
const MAX_DESCRIPTION = 400;

/**
 * A name match is worth more than a match in the description: the title is the
 * subject the business put first, while descriptions tend to share vocabulary
 * ("orders, deliveries, support") across every agent on the number.
 */
const NAME_WEIGHT = 2;

/**
 * Picks the agent that answers a conversation, without asking anybody.
 *
 * The question and every agent's name and description are folded by the same
 * `normalize` that search uses, and the agent sharing the most words wins.
 * Ties go to the oldest active agent, which makes the choice stable across
 * restarts and identical on every process reading the same rows.
 *
 * Three properties matter more than the choice itself:
 *
 * - A thread that already has an active owner is never re-routed, so two
 *   agents on one number cannot take turns inside a conversation.
 * - With one active agent there is no decision, which is every workspace that
 *   has not deliberately split its work.
 * - Nothing here can stop a reply: no overlap, a question with no subject or a
 *   switched-off agent all fall back to the oldest active agent, because
 *   answering from the wrong specialist costs one message and silence costs
 *   the customer.
 */
@Injectable()
export class AgentRouter {
  constructor(private readonly prisma: PrismaService) {}

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

    // The owner still works here. One indexed read, and the conversation keeps
    // the voice it started with.
    if (input.agentId && agents.some((agent) => agent.id === input.agentId)) {
      return { agentId: input.agentId, sticky: true };
    }

    // One agent is not a choice — and `orderBy` already made it the oldest.
    if (agents.length === 1) return { agentId: agents[0].id, sticky: false };

    const asked = normalize(input.question).terms;

    // A greeting names no subject, so no agent claims it and the oldest
    // answers — the same fallback as a tie.
    if (asked.length === 0) return { agentId: agents[0].id, sticky: false };

    let best = { agentId: agents[0].id, score: 0 };

    for (const agent of agents) {
      const score = overlap(agent, asked);

      // Strictly greater, so the first agent in `createdAt` order keeps a tie.
      if (score > best.score) best = { agentId: agent.id, score };
    }

    return { agentId: best.agentId, sticky: false };
  }
}

/** How many of the question's words this agent claims, name matches counted twice. */
function overlap(
  agent: { name: string; description: string | null },
  asked: string[],
): number {
  const name = new Set(tokensOf(agent.name));
  const hint = new Set(
    tokensOf((agent.description ?? "").slice(0, MAX_DESCRIPTION)),
  );

  let score = 0;

  for (const term of asked) {
    if (name.has(term)) score += NAME_WEIGHT;
    else if (hint.has(term)) score += 1;
  }

  return score;
}
