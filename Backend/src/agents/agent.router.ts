import { Injectable, Optional } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { OpenRouter } from "./ai.openrouter";
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

/** Which engine decided: the word overlap, the model, or the model failing. */
export type RoutingVia = "local" | "model" | "fallback";

export interface SmartRouting extends Routing {
  via: RoutingVia;
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
 * How long routing may take before the word overlap decides instead.
 *
 * Routing is the first of two calls a reply can cost. Three seconds leaves the
 * answer its ten and the runner its tick inside the fifteen the customer was
 * promised.
 */
const ROUTE_TIMEOUT_MS = 3_000;

/** The answer is one id. Room for "none" and a quoted id, and no more. */
const ROUTE_MAX_TOKENS = 24;

/** What the model is told. Its only output is an id copied from the list. */
const ROUTER_RULES = [
  "You choose which support agent answers one WhatsApp message.",
  "Reply with the id of the single agent that should answer, and nothing else.",
  "Choose the agent whose subject the question is about.",
  'If no agent is clearly the right one, or the message is a greeting with no subject, reply with none.',
  "The ids are opaque strings that look alike. Copy one exactly as it appears in the list.",
].join("\n");

/** One row as the router reads it. */
interface Candidate {
  id: string;
  name: string;
  description: string | null;
}

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
  constructor(
    private readonly prisma: PrismaService,
    /** Absent on a deployment with no key: the word overlap is then the router. */
    @Optional() private readonly ai?: OpenRouter,
  ) {}

  async choose(input: {
    whatsappAccountId: string;
    /** The thread's current owner, if it has one. */
    agentId: string | null;
    question: string;
  }): Promise<Routing> {
    const agents = await this.shortlist(input.whatsappAccountId);

    return decide(agents, input).routing;
  }

  /**
   * The same choice, with a model asked when the words do not settle it.
   *
   * The free decision is made first and kept whenever it is sure: a sticky
   * thread, a single agent, or one candidate that shares strictly more words
   * than every other. Only a question nobody claims — or one two agents claim
   * equally — is worth a round trip, which is also the only case where the
   * model can improve on the oldest agent answering.
   *
   * Every failure path ends at the same place as `choose`. Routing must not be
   * able to stop a reply: an unreachable provider, a refusal and a slow answer
   * are all "the model did not decide" and cost nothing but the wait.
   */
  async chooseSmart(input: {
    whatsappAccountId: string;
    agentId: string | null;
    question: string;
  }): Promise<SmartRouting> {
    const agents = await this.shortlist(input.whatsappAccountId);
    const { routing, confident } = decide(agents, input);

    if (confident || !this.ai?.configured) return { ...routing, via: "local" };

    const chosen = await this.askModel(agents, input.question);

    return chosen
      ? { agentId: chosen, sticky: false, via: "model" }
      : { ...routing, via: "fallback" };
  }

  private async shortlist(whatsappAccountId: string): Promise<Candidate[]> {
    return this.prisma.agent.findMany({
      where: { whatsappAccountId, isActive: true },
      orderBy: { createdAt: "asc" },
      take: MAX_CANDIDATES,
      select: { id: true, name: true, description: true },
    });
  }

  /** The model's answer as an id this workspace actually has, or null. */
  private async askModel(
    agents: Candidate[],
    question: string,
  ): Promise<string | null> {
    const list = agents
      .map(
        (agent) =>
          `- id: ${agent.id}\n  name: ${agent.name}\n  description: ${(agent.description ?? "").slice(0, MAX_DESCRIPTION)}`,
      )
      .join("\n");

    const outcome = await this.ai!.chat({
      messages: [
        { role: "system", content: ROUTER_RULES },
        { role: "user", content: `AGENTS\n${list}\n\nQUESTION\n${question}` },
      ],
      // An id, not a sentence: any sampling at all makes "none" less likely.
      temperature: 0,
      maxTokens: ROUTE_MAX_TOKENS,
      timeoutMs: ROUTE_TIMEOUT_MS,
    });

    if (!outcome.ok) return null;

    return idIn(outcome.text, agents);
  }
}

/**
 * The id the model named, checked against the list it was given.
 *
 * Never trusted: the reply becomes a foreign key. An id that is not on this
 * workspace's shortlist — a hallucinated one, or another tenant's — would bind
 * the conversation to an agent that cannot answer.
 */
function idIn(text: string, agents: Candidate[]): string | null {
  const first = text.trim().split(/[\s"'`.,;:)\]}]+/)[0] ?? "";
  const word = agents.find((agent) => agent.id === first);

  if (word) return word.id;

  // A model that wrapped the id in a sentence still named an agent.
  const quoted = agents.find((agent) => text.includes(agent.id));

  return quoted?.id ?? null;
}

/**
 * The free decision, and whether it is worth asking anybody about.
 *
 * `confident` is deliberately narrow. Zero overlap means the words named
 * nobody; a tie means they named two agents equally. Both are the cases a
 * model can read better than `overlap()` can. Everything else — including a
 * greeting, which has no subject to route on — is already settled.
 */
function decide(
  agents: Candidate[],
  input: { agentId: string | null; question: string },
): { routing: Routing; confident: boolean } {
  // Nobody is on duty: the message stays in the Inbox for a person.
  if (agents.length === 0) {
    return { routing: { agentId: null, sticky: false }, confident: true };
  }

  // The owner still works here. One indexed read, and the conversation keeps
  // the voice it started with.
  if (input.agentId && agents.some((agent) => agent.id === input.agentId)) {
    return { routing: { agentId: input.agentId, sticky: true }, confident: true };
  }

  // One agent is not a choice — and `orderBy` already made it the oldest.
  if (agents.length === 1) {
    return { routing: { agentId: agents[0].id, sticky: false }, confident: true };
  }

  const asked = normalize(input.question).terms;

  // A greeting names no subject, so no agent claims it and the oldest
  // answers — the same fallback as a tie. No model is asked: it has been
  // given less to go on than the overlap had.
  if (asked.length === 0) {
    return { routing: { agentId: agents[0].id, sticky: false }, confident: true };
  }

  let best = { agentId: agents[0].id, score: 0 };
  let claimants = 0;

  for (const agent of agents) {
    const score = overlap(agent, asked);

    // Strictly greater, so the first agent in `createdAt` order keeps a tie.
    if (score > best.score) {
      best = { agentId: agent.id, score };
      claimants = 1;
    } else if (score === best.score) {
      claimants += 1;
    }
  }

  return {
    routing: { agentId: best.agentId, sticky: false },
    confident: best.score > 0 && claimants === 1,
  };
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
