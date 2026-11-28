import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** One turn, as OpenRouter's chat completions endpoint spells it. */
export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatTurn[];
  /** The agent's stored model. Sanitised here, never trusted as written. */
  model?: string | null;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

/**
 * Why no answer came back.
 *
 * `not-configured` is the ordinary case on a deployment with no key, so it is
 * an outcome rather than an error: every caller has a real answer to give
 * without a model, and none of them should have to catch to find that out.
 */
export type ChatFailure =
  | "not-configured"
  | "timeout"
  | "unreachable"
  | "refused"
  | "empty";

export type ChatOutcome =
  | { ok: true; text: string; model: string }
  | { ok: false; reason: ChatFailure; detail: string };

/**
 * A model id OpenRouter would recognise: `vendor/model`.
 *
 * The guard exists because of this database's own default. `agents.model`
 * ships as `gpt-5.4-mini`, which is not an OpenRouter id — sending it as stored
 * would fail every single reply with a 404, on a path that has already spent
 * its latency budget.
 */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** The configured ceiling; `env.ts` refuses a value that would break the budget. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * OpenRouter's chat completions API, over `fetch`.
 *
 * No SDK: three fields of a request and two of a response are all this app
 * uses, and a provider package would be a dependency to keep current for that.
 *
 * Nothing here decides what a reply *says*. It sends messages and returns the
 * text, or says why it could not — the caller falls back to the extractive
 * composer it already had.
 */
@Injectable()
export class OpenRouter {
  private readonly logger = new Logger(OpenRouter.name);
  private readonly base: string;
  private readonly key: string | null;
  private readonly model: string;
  private readonly referer: string | null;
  private readonly title: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.base = (
      config.get<string>("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1"
    ).replace(/\/+$/, "");

    const key = config.get<string>("OPEN_ROUTER_API_KEY") ?? "";

    this.key = key.trim().length > 0 ? key.trim() : null;
    this.model = config.get<string>("OPENROUTER_MODEL") ?? "openrouter/free";
    this.referer = config.get<string>("OPENROUTER_SITE_URL") ?? null;
    this.title = config.get<string>("OPENROUTER_SITE_NAME") ?? "AOTMS";
    this.timeoutMs = config.get<number>("OPENROUTER_TIMEOUT_MS") ?? DEFAULT_TIMEOUT_MS;
  }

  get configured(): boolean {
    return this.key !== null;
  }

  /** The model one call should use: the agent's own if it names a real one. */
  modelFor(stored?: string | null): string {
    const wanted = (stored ?? "").trim();

    return MODEL_ID.test(wanted) ? wanted : this.model;
  }

  async chat(request: ChatRequest): Promise<ChatOutcome> {
    if (!this.key) {
      return {
        ok: false,
        reason: "not-configured",
        detail: "OPEN_ROUTER_API_KEY is not set.",
      };
    }

    const model = this.modelFor(request.model);

    let response: Response;

    try {
      response = await fetch(`${this.base}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model,
          messages: request.messages,
          temperature: request.temperature ?? 0.4,
          max_tokens: request.maxTokens ?? 500,
        }),
        signal: AbortSignal.timeout(request.timeoutMs ?? this.timeoutMs),
      });
    } catch (error) {
      return {
        ok: false,
        reason: isTimeout(error) ? "timeout" : "unreachable",
        detail: isTimeout(error)
          ? "OpenRouter did not answer in time."
          : "OpenRouter could not be reached.",
      };
    }

    if (!response.ok) {
      const detail = `OpenRouter answered ${response.status}${await messageOf(response)}`;

      // Kept because it is the only place the vendor's own sentence survives:
      // "402 insufficient credit" and "429 rate limited" are the same status
      // line and a completely different fix. Logged because the reply path
      // treats every refusal the same way — it falls back to the extractive
      // answer and the customer is still served, so a dead key or an empty
      // account would otherwise be invisible in production.
      this.logger.warn(`${model}: ${detail}`);

      return { ok: false, reason: "refused", detail };
    }

    const payload = (await response.json().catch(() => null)) as {
      model?: string;
      choices?: { message?: { content?: unknown } }[];
    } | null;

    const content = payload?.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";

    if (text.length === 0) {
      // A reasoning model can spend the whole `max_tokens` budget thinking and
      // return no visible content at all. Same outcome as a refusal — the
      // extractive answer speaks — but worth a line, because it looks like a
      // model that works.
      this.logger.warn(`${model}: the model returned no visible text.`);

      return {
        ok: false,
        reason: "empty",
        detail: "The model returned no text.",
      };
    }

    return { ok: true, text, model: payload?.model ?? model };
  }

  /** Attribution headers, and the bearer that actually authorises. */
  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.key as string}`,
      "content-type": "application/json",
      "X-Title": this.title,
    };

    if (this.referer) headers["HTTP-Referer"] = this.referer;

    return headers;
  }
}

/** The vendor's `error.message`, when the refusal carried one. */
async function messageOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: unknown };
  } | null;

  const message = body?.error?.message;

  return typeof message === "string" && message.length > 0 ? `: ${message}` : ".";
}

/** `AbortSignal.timeout` rejects with `TimeoutError`; older runtimes say `AbortError`. */
function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}