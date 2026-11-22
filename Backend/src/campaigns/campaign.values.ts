/**
 * What a campaign fills a template's `{{token}}` with.
 *
 * Two kinds only: one value for everybody, or one field of the recipient. That
 * covers the greeting — the only per-recipient substitution a broadcast needs —
 * and keeps the stored JSON small enough to read in a psql session.
 *
 * The tokens themselves are not decided here: `shapeOf()` reads them out of the
 * components Meta approved, which is the only list that cannot be wrong.
 */

export type TokenBinding =
  | { kind: "static"; value: string }
  | { kind: "contact"; field: "name" | "waId"; fallback?: string };

export type BindingMap = Record<string, TokenBinding>;

/** Tolerant parse: the column is JSON, and old rows may predate a field. */
export function bindingsOf(input: unknown): BindingMap {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }

  const out: BindingMap = {};

  for (const [token, raw] of Object.entries(input as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;

    const entry = raw as Record<string, unknown>;

    if (entry.kind === "static" && typeof entry.value === "string") {
      out[token] = { kind: "static", value: entry.value };
      continue;
    }

    if (
      entry.kind === "contact" &&
      (entry.field === "name" || entry.field === "waId")
    ) {
      out[token] = {
        kind: "contact",
        field: entry.field,
        ...(typeof entry.fallback === "string"
          ? { fallback: entry.fallback }
          : {}),
      };
    }
  }

  return out;
}

/**
 * Everything that would send an empty `{{n}}` to a customer, in the order the
 * form shows the tokens. Returning a list rather than throwing keeps this
 * module free of HTTP concerns, exactly like `template-send.ts`.
 */
export function problemsInBindings(
  tokens: string[],
  bindings: BindingMap,
): string[] {
  const problems: string[] = [];

  for (const token of tokens) {
    const binding = bindings[token];

    if (!binding) {
      problems.push(`Choose a value for {{${token}}}.`);
      continue;
    }

    if (binding.kind === "static" && !binding.value.trim()) {
      problems.push(`Fill in {{${token}}}.`);
    }

    // A name is optional on every contact and Meta rejects an empty parameter,
    // so the fallback is the only thing between a nameless contact and a
    // failed send. Asking for it is cheaper than silently inventing one.
    if (
      binding.kind === "contact" &&
      binding.field === "name" &&
      !binding.fallback?.trim()
    ) {
      problems.push(
        `Give {{${token}}} a fallback for contacts with no saved name.`,
      );
    }
  }

  return problems;
}

/** One contact's values. Called once per recipient, immediately before a send. */
export function resolveValues(
  bindings: BindingMap,
  contact: { profileName: string | null; waId: string },
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [token, binding] of Object.entries(bindings)) {
    if (binding.kind === "static") {
      out[token] = binding.value.trim();
      continue;
    }

    out[token] =
      binding.field === "waId"
        ? contact.waId
        : (contact.profileName?.trim() ?? "") || (binding.fallback?.trim() ?? "");
  }

  return out;
}
