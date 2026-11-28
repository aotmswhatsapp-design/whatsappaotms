/** How many chunks the prompt can carry before it stops being one answer. */
export const TOP_K = 6;

/**
 * How many rows the database is asked for before any floor is applied.
 *
 * Both engines read more than they keep: a threshold decides after the scores
 * are known, so the rows that a floor will reject still have to arrive. It is
 * one wider scan, not a second query.
 */
export const CANDIDATES = 24;

/**
 * How much of the retrieved material one prompt may carry.
 *
 * The chunks arrive already ranked, so the cut is at the end of the list, not
 * inside a chunk: a sliced price table is a prompt that invites a wrong
 * answer. Six thousand characters is roughly a thousand tokens — enough for
 * six chunks and a conversation, and small enough that the model's first token
 * still arrives inside the fifteen-second budget.
 */
export const MAX_CONTEXT_CHARS = 6_000;
