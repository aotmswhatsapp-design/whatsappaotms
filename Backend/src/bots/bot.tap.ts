/**
 * What a customer's message says about a button they were offered.
 *
 * Three separate pieces of evidence, because they fail independently: the id we
 * set on the button, a number typed into the fallback, and the words on screen.
 * Kept as evidence rather than as a decision — routing decides which one to
 * trust — so that a card edited after it was sent can still be answered.
 */
export interface TapEvidence {
  /** The id from the delivery, when Meta returned one. Authoritative. */
  id: string | null;
  /** A 1-based position, when the customer answered the numbered fallback. */
  number: number | null;
  /** The title they tapped, or the words they typed. */
  label: string | null;
}

/** A whole message that is one number: `2`, `#2`, `2)`, `2.`. */
const NUMBER_ONLY = /^\s*#?(\d{1,2})\s*[).:\-]?\s*$/u;

export function readTap(input: {
  /** The message as the thread shows it: the tapped title, or what was typed. */
  body: string | null;
  /** The stored contents: `{ tap: { id, title } }` for a button or a list row. */
  payload: unknown;
}): TapEvidence {
  const tap = tapOf(input.payload);
  const body = input.body?.trim() ?? "";

  return {
    id: tap?.id ?? null,
    number: numberOf(body),
    label: tap?.title ?? (body.length > 0 ? body : null),
  };
}

/** The stored `tap` object, read defensively: this column is JSON and may be anything. */
function tapOf(payload: unknown): { id: string; title: string } | null {
  if (payload === null || typeof payload !== "object") return null;

  const tap = (payload as { tap?: unknown }).tap;

  if (tap === null || typeof tap !== "object") return null;

  const { id, title } = tap as { id?: unknown; title?: unknown };

  if (typeof id !== "string" || id.length === 0) return null;

  return { id, title: typeof title === "string" ? title : id };
}

/**
 * The position, or null.
 *
 * Deliberately strict: `2 people` is an answer to a question, not a pick from a
 * menu. The caller only asks this of a message that belongs to a card, so a bare
 * number there really is a choice.
 */
function numberOf(body: string): number | null {
  const match = NUMBER_ONLY.exec(body);
  if (!match) return null;

  const index = Number(match[1]);

  return Number.isInteger(index) && index > 0 ? index : null;
}
