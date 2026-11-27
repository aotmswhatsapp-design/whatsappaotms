import type { LeadInterest } from "@prisma/client";

/** The board's columns, in the order the screen draws them. */
export type BoardColumn = "NEW" | "INTERESTED" | "FOLLOW_UP" | "NOT_INTERESTED";

export const BOARD_COLUMNS: readonly { key: BoardColumn; label: string }[] = [
  { key: "NEW", label: "New" },
  { key: "INTERESTED", label: "Interested" },
  { key: "FOLLOW_UP", label: "Follow-up" },
  { key: "NOT_INTERESTED", label: "Not interested" },
];

/**
 * A conversation's column, derived from what is stored rather than kept in a
 * second field: a stale column is a bug a board cannot recover from.
 */
export function columnOf(row: {
  interest: LeadInterest;
  openTask: { id: string } | null;
}): BoardColumn {
  if (row.interest === "NOT_INTERESTED") return "NOT_INTERESTED";
  if (row.interest === "INTERESTED") return row.openTask ? "FOLLOW_UP" : "INTERESTED";
  return "NEW";
}
