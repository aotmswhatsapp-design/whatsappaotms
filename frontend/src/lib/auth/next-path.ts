/**
 * The `next` parameter an auth screen is allowed to send a visitor back to.
 *
 * Only an in-app path survives: anything absolute, protocol-relative or
 * malformed is discarded, so a crafted `?next=` cannot turn a login form into
 * an open redirect. The client-side twin of this rule lives in
 * `nextPath()`; server pages need their own copy because `window` is not
 * available to them.
 */
export function safeNext(
  value: string | string[] | null | undefined,
): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const path = raw?.trim();

  return path && path.startsWith("/") && !path.startsWith("//") ? path : null;
}
