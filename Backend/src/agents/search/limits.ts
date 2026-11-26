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
