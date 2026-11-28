import type { DetectedLanguage } from "../language.detect";
import { HANDOFF_SENTINEL, cleanReply } from "../reply.prompt";
import { composeAnswer } from "./compose";
import type { ContextChunk } from "./context-chunk";
import { noMaterialMessages, replyMessages } from "./reply.compose";

/**
 * The one method an answer needs from a chat provider.
 *
 * Structural on purpose: the search layer knows how to ask for a sentence and
 * what to do with one, and nothing about which vendor wrote it, which key
 * authorises it or how it is retried. `OpenRouter` satisfies this without the
 * import, and a test satisfies it with three lines.
 */
export interface Chatter {
  chat(request: {
    messages: { role: "system" | "user" | "assistant"; content: string }[];
    model?: string | null;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  }): Promise<{ ok: true; text: string } | { ok: false; reason: string }>;
}

export interface AnswerAgent {
  name: string;
  systemPrompt: string;
  /** The agent's stored model; the provider decides whether it is a real id. */
  model: string | null;
  maxReplyChars: number;
}

export type AnswerOutcome =
  | {
      ok: true;
      body: string;
      /** The chunks the answer stands on. For a model answer, all of them. */
      used: ContextChunk[];
      via: "model" | "extractive";
    }
  | { ok: false; reason: "no-context" };

/** Everything one reply needs: who is speaking, to whom, and what was found. */
export interface AnswerInput {
  agent: AnswerAgent;
  question: string;
  chunks: ContextChunk[];
  language: DetectedLanguage;
  /** Absent when no key is configured: the extractive answer is the answer. */
  chatter?: Chatter | null;
  maxContextChars?: number;
  timeoutMs?: number;
}

/**
 * The reply, from the model when it can write one and from the business's own
 * sentences when it cannot.
 *
 * The order is the whole design. A model that answers well is better than a
 * quote; a model that is down, slow or out of credit must never be the reason
 * a customer waits. So the cheap answer is computed *after* a refusal, from
 * material that was fetched either way, and the two are the same message to
 * everyone downstream — one body, one length ceiling, one link check.
 *
 * `no-context` is returned only when both engines came up empty: the caller
 * then sends the handoff line and pauses the thread. An empty model answer is
 * not a reason to stop trying — it is a reason to fall back.
 */
export async function answerFrom(input: AnswerInput): Promise<AnswerOutcome> {
  const maxChars = input.agent.maxReplyChars;

  // Nothing was retrieved. This is not automatically a question the business
  // has to answer by hand: "hi" and "do you speak Telugu" retrieve nothing,
  // and handing those off pauses the thread, which then swallows everything
  // the customer says next. So the model is asked anyway, under a prompt that
  // carries no material at all — it can make conversation, and cannot state a
  // price, an address or a promise, because it was given none.
  if (input.chunks.length === 0) return ungrounded(input, maxChars);

  const context = input.chunks.map((chunk) => chunk.text).join("\n\n");

  if (input.chatter) {
    const messages = replyMessages({
      agentName: input.agent.name,
      systemPrompt: input.agent.systemPrompt,
      question: input.question,
      chunks: input.chunks,
      language: input.language,
      maxChars,
      maxContextChars: input.maxContextChars,
    });

    const outcome = await input.chatter.chat({
      messages: [
        { role: "system", content: messages.system },
        { role: "user", content: messages.user },
      ],
      model: input.agent.model,
      // A support answer that restates the material is helped by little
      // invention and hurt by a lot of it.
      temperature: 0.2,
      maxTokens: tokensFor(maxChars),
      timeoutMs: input.timeoutMs,
    });

    // Checked before cleaning, because the sentinel is the model's decision:
    // a reply that says it and then explains itself is still a decline.
    if (outcome.ok && !outcome.text.includes(HANDOFF_SENTINEL)) {
      const body = cleanReply(outcome.text, { maxChars, context });

      if (body.length > 0) {
        return { ok: true, body, used: input.chunks, via: "model" };
      }
    }
  }

  return extractive(input.question, input.chunks, maxChars, context);
}

/**
 * The reply to a message no chunk was retrieved for.
 *
 * Only conversation is on offer here, so a model that asks for a business fact
 * — which is every question the rules say to decline — leaves `no-context` as
 * the outcome and the caller hands the thread to a person, exactly as before.
 * The empty context is also the link guard: `cleanReply` strips every URL when
 * the material names none, and here it names none by definition.
 */
async function ungrounded(
  input: AnswerInput,
  maxChars: number,
): Promise<AnswerOutcome> {
  if (!input.chatter) return { ok: false, reason: "no-context" };

  const messages = noMaterialMessages({
    agentName: input.agent.name,
    systemPrompt: input.agent.systemPrompt,
    question: input.question,
    language: input.language,
    maxChars,
  });

  const outcome = await input.chatter.chat({
    messages: [
      { role: "system", content: messages.system },
      { role: "user", content: messages.user },
    ],
    model: input.agent.model,
    temperature: 0.2,
    maxTokens: tokensFor(maxChars),
    timeoutMs: input.timeoutMs,
  });

  // Checked before cleaning, because the sentinel is the model's decision:
  // a reply that says it and then explains itself is still a decline.
  if (!outcome.ok || outcome.text.includes(HANDOFF_SENTINEL)) {
    return { ok: false, reason: "no-context" };
  }

  const body = cleanReply(outcome.text, { maxChars, context: "" });

  if (body.length === 0) return { ok: false, reason: "no-context" };

  // No chunks were used, and none exist: `used` is empty on purpose, so an
  // operator reading the trace is not shown material that had no part in it.
  return { ok: true, body, used: [], via: "model" };
}

/**
 * The answer as the business wrote it: sentences copied out of the material.
 *
 * This was the only path before the model, and it stays because it cannot be
 * down, over quota or slow — and because it cannot invent a price.
 */
function extractive(
  question: string,
  chunks: ContextChunk[],
  maxChars: number,
  context: string,
): AnswerOutcome {
  const composed = composeAnswer({ question, chunks, maxChars });

  if (!composed) return { ok: false, reason: "no-context" };

  const body = cleanReply(composed.body, { maxChars, context });

  // Cleaning can empty a reply — a sentence that was nothing but an invented
  // link is removed line by line. Silence is not an answer either.
  if (body.length === 0) return { ok: false, reason: "no-context" };

  return { ok: true, body, used: composed.used, via: "extractive" };
}

/**
 * Room for the reply, in tokens rather than characters.
 *
 * Telugu, Hindi and Tenglish all spend more tokens per character than English
 * does, so the allowance is generous relative to the character ceiling: the
 * cut is applied once, by `cleanReply`, on a sentence boundary. A model that
 * runs into `max_tokens` mid-word produces exactly the half-sentence the
 * truncation exists to avoid.
 */
function tokensFor(maxChars: number): number {
  return Math.max(300, Math.ceil(maxChars / 1.5));
}