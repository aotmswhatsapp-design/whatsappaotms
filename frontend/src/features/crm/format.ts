/**
 * How the CRM writes a date: the day and the month, never the year.
 *
 * A follow-up is due in days or weeks, so "3 Dec" is the whole answer; the
 * board, the follow-up list, the thread strip and the overview card all read
 * the same words, so a deadline cannot look different in two places.
 */
export function shortDate(iso: string | null): string {
  if (!iso) return "no date";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}
