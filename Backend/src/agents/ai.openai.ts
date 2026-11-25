import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AiError, ExtractError } from "./ai.errors";

/** 1536 is text-embedding-3-small's native width, and the column's. */
export const EMBED_DIMS = 1536;

/** The model a new agent starts with; copying it into the row is Task 10's job. */
export const DEFAULT_CHAT_MODEL = "gpt-5.4-mini";

const TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 180_000;
const ATTEMPTS = 3;
const BACKOFF_MS = 800;

const VISION_INSTRUCTION = [
  "You are reading a business document for a searchable index.",
  "Transcribe every word, number and table row you can read, preserving order.",
  "Then, on a new line, describe any chart, diagram or photograph in one sentence.",
  "Do not summarise away a price, a date, an address or a policy.",
].join(" ");

export type ChatContent =
  | string
  | (
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    )[];

export interface ChatMessage {
  role: "user" | "assistant";
  content: ChatContent;
}

export interface ChatInput {
  model: string;
  system: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
}

export interface ChatResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface ChatBody {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: Usage;
  data?: { embedding: number[]; index: number }[];
  error?: { message?: string };
  text?: string;
}

/** An embedding, as pgvector's text form: `[0.1,0.2,...]`. */
export function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

@Injectable()
export class OpenAiProvider {
  private readonly logger = new Logger(OpenAiProvider.name);

  constructor(private readonly config: ConfigService) {}

  /** False when the key is absent. Routes that need it answer 503. */
  get configured(): boolean {
    return this.key.length > 0;
  }

  private get key(): string {
    return this.config.get<string>("OPENAI_API_KEY") ?? "";
  }

  private get base(): string {
    return (
      this.config.get<string>("OPENAI_BASE_URL") ?? "https://api.openai.com/v1"
    ).replace(/\/+$/, "");
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    const body = (await this.request("/chat/completions", ATTEMPTS, () => ({
      method: "POST",
      headers: this.jsonHeaders(),
      // `max_completion_tokens`, never `max_tokens`: the gpt-5 family answers
      // 400 unsupported_parameter for the older name. Verified on this key.
      body: JSON.stringify({
        model: input.model,
        temperature: input.temperature,
        max_completion_tokens: input.maxTokens,
        messages: [
          { role: "system", content: input.system },
          ...input.messages,
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }))) as ChatBody;

    const text = body.choices?.[0]?.message?.content?.trim() ?? "";

    if (text.length === 0) {
      throw new AiError("AI_UNAVAILABLE", "The model returned an empty reply.");
    }

    return {
      text,
      tokensIn: body.usage?.prompt_tokens ?? 0,
      tokensOut: body.usage?.completion_tokens ?? 0,
    };
  }

  async embed(input: string[]): Promise<{ vectors: number[][]; tokens: number }> {
    if (input.length === 0) return { vectors: [], tokens: 0 };

    const model =
      this.config.get<string>("OPENAI_EMBED_MODEL") ?? "text-embedding-3-small";

    const body = (await this.request("/embeddings", ATTEMPTS, () => ({
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }))) as ChatBody;

    const rows = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
    const vectors = rows.map((row) => row.embedding);

    if (vectors.length !== input.length) {
      throw new AiError(
        "AI_UNAVAILABLE",
        `OpenAI returned ${vectors.length} embeddings for ${input.length} inputs.`,
      );
    }

    for (const vector of vectors) {
      if (vector.length !== EMBED_DIMS) {
        throw new AiError(
          "AI_UNAVAILABLE",
          `An embedding came back with ${vector.length} dimensions, not ${EMBED_DIMS}. The column is welded to ${EMBED_DIMS}.`,
        );
      }
    }

    return { vectors, tokens: body.usage?.prompt_tokens ?? 0 };
  }

  /** Read an image with the agent's own chat model. Verified: it is multimodal. */
  async describeImage(input: {
    bytes: Buffer;
    mime: string;
    model: string;
  }): Promise<ChatResult> {
    const url = `data:${input.mime};base64,${input.bytes.toString("base64")}`;

    const body = (await this.request("/chat/completions", ATTEMPTS, () => ({
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        model: input.model,
        temperature: 0.1,
        max_completion_tokens: 1200,
        messages: [
          { role: "system", content: VISION_INSTRUCTION },
          {
            role: "user",
            content: [
              { type: "text", text: "Transcribe and describe this page." },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    }))) as ChatBody;

    const text = body.choices?.[0]?.message?.content?.trim() ?? "";

    if (text.length === 0) {
      throw new ExtractError(
        "SOURCE_EMPTY",
        "Nothing readable was found in that image.",
      );
    }

    return {
      text,
      tokensIn: body.usage?.prompt_tokens ?? 0,
      tokensOut: body.usage?.completion_tokens ?? 0,
    };
  }

  /**
   * Whisper, as multipart. It writes numbers as digits — "fifty" comes back
   * "50" — which is why the reply prompt forbids quoting a price the context
   * does not contain.
   */
  async transcribe(input: {
    bytes: Buffer;
    mime: string;
    name: string;
  }): Promise<{ text: string }> {
    const body = (await this.request(
      "/audio/transcriptions",
      ATTEMPTS,
      () => {
        const form = new FormData();
        form.append(
          "file",
          new Blob([new Uint8Array(input.bytes)], { type: input.mime }),
          input.name,
        );
        form.append("model", "whisper-1");
        form.append("response_format", "json");

        return {
          method: "POST",
          // No content-type: fetch adds the multipart boundary itself.
          headers: this.authHeaders(),
          body: form,
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        };
      },
    )) as ChatBody;

    const text = (body.text ?? "").trim();

    if (text.length === 0) {
      throw new ExtractError(
        "SOURCE_EMPTY",
        "No speech was found in that recording.",
      );
    }

    return { text };
  }

  private jsonHeaders(): Record<string, string> {
    return { ...this.authHeaders(), "content-type": "application/json" };
  }

  private authHeaders(): Record<string, string> {
    if (!this.configured) {
      throw new AiError(
        "AI_NOT_CONFIGURED",
        "AI is not configured. Set OPENAI_API_KEY on the API and restart it.",
      );
    }

    return { authorization: `Bearer ${this.key}` };
  }

  /**
   * One request, three attempts. The body is built per attempt so a retried
   * upload gets a fresh FormData; a rejected key and a refused parameter are
   * not retried, because nothing about them changes.
   */
  private async request(
    path: string,
    attempts: number,
    build: () => RequestInit,
  ): Promise<unknown> {
    let last: unknown = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let outcome: { ok: true; body: unknown } | { ok: false; response: Response };

      try {
        const response = await fetch(`${this.base}${path}`, build());

        // The body is read inside the guard too: a download aborted after the
        // headers arrive is a failed attempt, not an unclassified error that
        // escapes the retry loop.
        outcome = response.ok
          ? { ok: true, body: await response.json() }
          : { ok: false, response };
      } catch (error) {
        // A missing key or a refused parameter reads the same on every attempt,
        // so an AiError that is not retryable leaves the loop immediately.
        if (error instanceof AiError && !error.retryable) throw error;

        last = error;
        if (attempt === attempts) break;
        this.logger.warn(
          `OpenAI ${path} failed on attempt ${attempt}: ${error instanceof Error ? error.message : "unknown failure"}`,
        );
        await sleep(BACKOFF_MS * attempt);
        continue;
      }

      if (outcome.ok) return outcome.body;

      const response = outcome.response;
      const detail = await sentenceOf(response);

      if (response.status === 401 || response.status === 403) {
        throw new AiError(
          "AI_UNAUTHORIZED",
          `OpenAI rejected the API key. ${detail}`,
        );
      }

      if (response.status === 429) {
        last = new AiError(
          "AI_RATE_LIMITED",
          `OpenAI is rate limiting this key. ${detail}`,
          true,
        );
        if (attempt === attempts) break;
        // A 429 asks for a longer pause than a dropped socket.
        this.logger.warn(`OpenAI rate limited ${path} on attempt ${attempt}.`);
        await sleep(BACKOFF_MS * attempt * 3);
        continue;
      }

      if (response.status >= 500) {
        last = new AiError("AI_UNAVAILABLE", `OpenAI failed. ${detail}`, true);
        if (attempt === attempts) break;
        this.logger.warn(`OpenAI answered ${response.status} on ${path}, attempt ${attempt}.`);
        await sleep(BACKOFF_MS * attempt);
        continue;
      }

      throw new AiError("AI_UNAVAILABLE", `OpenAI refused the request. ${detail}`);
    }

    if (last instanceof AiError) throw last;

    throw new AiError(
      "AI_UNAVAILABLE",
      `Could not reach OpenAI. ${last instanceof Error ? last.message : "unknown failure"}`,
      true,
    );
  }
}

/** OpenAI answers `{ error: { message } }`; anything else is a gateway. */
async function sentenceOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ChatBody | null;
  const message = body?.error?.message;

  if (typeof message === "string" && message.trim().length > 0) {
    return message.trim();
  }

  return `HTTP ${response.status}.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
