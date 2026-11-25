/**
 * The two families of failure this module can explain to a caller.
 *
 * OpenAI's own sentence is carried in `message` — it names the model, the
 * parameter or the key, and it is the only text worth showing a developer.
 * `code` is what a route turns into the HTTP refusal; the frontend matches on
 * it rather than on English.
 */
export type AiCode =
  | "AI_NOT_CONFIGURED"
  | "AI_UNAUTHORIZED"
  | "AI_RATE_LIMITED"
  | "AI_UNAVAILABLE";

export class AiError extends Error {
  constructor(
    readonly code: AiCode,
    message: string,
    /** A second attempt could succeed: timeouts, 429, 5xx. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** Why a file could not become text. Every one is a sentence for the screen. */
export type ExtractCode = "SOURCE_UNSUPPORTED" | "SOURCE_EMPTY" | "SOURCE_TOO_LARGE";

export class ExtractError extends Error {
  constructor(
    readonly code: ExtractCode,
    message: string,
  ) {
    super(message);
    this.name = "ExtractError";
  }
}
