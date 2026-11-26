/** Why a file could not become text. Every one is a sentence for the screen. */
export type ExtractCode =
  | "SOURCE_UNSUPPORTED"
  | "SOURCE_EMPTY"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_TIMEOUT";

export class ExtractError extends Error {
  constructor(
    readonly code: ExtractCode,
    message: string,
  ) {
    super(message);
    this.name = "ExtractError";
  }
}
