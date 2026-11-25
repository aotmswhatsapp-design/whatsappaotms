/**
 * Splitting text for retrieval.
 *
 * Characters stand in for tokens: there is no tokenizer in the dependency
 * list, and 3,200 characters is close enough to 800 tokens that retrieval
 * quality does not notice. A boundary in the last 300 characters is preferred
 * so a chunk rarely starts mid-sentence, and 480 characters of overlap keep an
 * answer that straddles a cut visible to both chunks.
 */
export const CHUNK_CHARS = 3_200;
export const OVERLAP_CHARS = 480;
export const MAX_CHUNKS = 5_000;

const BOUNDARY_LOOKBACK = 300;

export function splitText(raw: string): string[] {
  const text = raw.replace(/\r\n?/g, "\n").trim();

  if (text.length === 0) return [];
  if (text.length <= CHUNK_CHARS) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const hard = Math.min(start + CHUNK_CHARS, text.length);
    const end =
      hard < text.length
        ? (boundaryOf(
            text,
            Math.max(start + CHUNK_CHARS - BOUNDARY_LOOKBACK, start + 1),
            hard,
          ) ?? hard)
        : hard;

    const piece = text.slice(start, end).trim();
    if (piece.length > 0) chunks.push(piece);

    if (end >= text.length) break;

    // Always forward: a boundary found far back would otherwise loop forever.
    start = Math.max(end - OVERLAP_CHARS, start + 1);
  }

  return chunks;
}

/** A paragraph, then a sentence, then a line, then nothing. */
function boundaryOf(text: string, from: number, to: number): number | null {
  const window = text.slice(from, to);

  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph >= 0) return from + paragraph + 2;

  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  );
  if (sentence >= 0) return from + sentence + 2;

  const line = window.lastIndexOf("\n");
  if (line >= 0) return from + line + 1;

  return null;
}

/** Four characters per token is the usual English average, and an estimate. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
