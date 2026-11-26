import type { SourceBlock } from "./extract";

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
    const end = wholePointAt(
      text,
      hard < text.length
        ? (boundaryOf(
            text,
            Math.max(start + CHUNK_CHARS - BOUNDARY_LOOKBACK, start + 1),
            hard,
          ) ?? hard)
        : hard,
      -1,
    );

    const piece = text.slice(start, end).trim();
    if (piece.length > 0) chunks.push(piece);

    if (end >= text.length) break;

    // Always forward: a boundary found far back would otherwise loop forever.
    start = wholePointAt(text, Math.max(end - OVERLAP_CHARS, start + 1), 1);
  }

  return chunks;
}

/**
 * A cut placed between a high and a low surrogate would store half a character
 * at each end of two chunks, so it moves one unit in the asked-for direction.
 */
function wholePointAt(text: string, at: number, direction: 1 | -1): number {
  if (at <= 0 || at >= text.length) return at;

  const before = text.charCodeAt(at - 1);
  const after = text.charCodeAt(at);
  const inside =
    before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;

  return inside ? at + direction : at;
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

export interface ChunkDraft {
  text: string;
  page?: number;
  sheet?: string;
  rowFrom?: number;
  rowTo?: number;
  heading?: string;
}

/**
 * Blocks to chunks, without ever claiming a page it does not have.
 *
 * Two blocks are packed only when they share a page, a sheet and a heading and
 * neither is part of a table: a row range that spans two blocks is a range the
 * citation would have to invent, and a repeated "Columns:" line in the middle
 * of a chunk reads like a second table.
 */
export function chunkBlocks(blocks: SourceBlock[]): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  let open: ChunkDraft | null = null;

  const flush = () => {
    if (open && open.text.trim().length > 0) chunks.push(open);
    open = null;
  };

  for (const block of blocks) {
    const pieces = block.text.length <= CHUNK_CHARS ? [block.text] : splitText(block.text);

    for (const piece of pieces) {
      const compatible =
        open !== null &&
        open.page === block.page &&
        open.sheet === block.sheet &&
        open.heading === block.heading &&
        open.rowFrom === undefined &&
        block.rowFrom === undefined &&
        open.text.length + piece.length + 2 <= CHUNK_CHARS;

      if (compatible && open) {
        open.text = `${open.text}\n\n${piece}`;
        continue;
      }

      flush();
      open = {
        text: piece,
        ...(block.page !== undefined ? { page: block.page } : {}),
        ...(block.sheet !== undefined ? { sheet: block.sheet } : {}),
        ...(block.rowFrom !== undefined ? { rowFrom: block.rowFrom } : {}),
        ...(block.rowTo !== undefined ? { rowTo: block.rowTo } : {}),
        ...(block.heading !== undefined ? { heading: block.heading } : {}),
      };
    }
  }

  flush();
  return chunks;
}
