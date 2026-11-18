/** One date format for the whole module, so two panels cannot disagree. */
export function when(iso: string | null): string {
  if (!iso) return "—";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
