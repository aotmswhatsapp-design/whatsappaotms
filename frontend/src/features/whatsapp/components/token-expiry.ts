/** Days before expiry at which the connection starts warning. One constant. */
export const TOKEN_WARNING_DAYS = 7;

export type ExpiryState = "none" | "ok" | "soon" | "expired";

/**
 * `null` means "Meta said never, or we never learned" — the honest answer is to
 * say nothing, so this returns "none" rather than inventing a date.
 */
export function expiryState(iso: string | null, now = Date.now()): ExpiryState {
  if (!iso) return "none";

  const at = Date.parse(iso);

  if (Number.isNaN(at)) return "none";

  const days = Math.ceil((at - now) / 86_400_000);

  if (days <= 0) return "expired";

  return days <= TOKEN_WARNING_DAYS ? "soon" : "ok";
}

export function expiryDays(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;

  const at = Date.parse(iso);

  return Number.isNaN(at) ? null : Math.ceil((at - now) / 86_400_000);
}
