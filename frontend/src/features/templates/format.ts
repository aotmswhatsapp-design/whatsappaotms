/**
 * Meta's vocabulary, in the words the screen uses.
 *
 * Everything here renders after a client fetch, so locale-dependent formatting
 * is safe: there is no server pass to disagree with.
 */

const CATEGORY_LABELS: Record<string, string> = {
  AUTHENTICATION: "Authentication",
  MARKETING: "Marketing",
  UTILITY: "Utility",
};

/**
 * Review states. Meta's names are stable; anything new is humanised rather
 * than hidden, so a status this build has not seen still reads as a word.
 */
const STATUS_LABELS: Record<string, string> = {
  APPROVED: "Approved",
  PENDING: "In review",
  REJECTED: "Rejected",
  PAUSED: "Paused",
  DISABLED: "Disabled",
  DELETED: "Deleted",
  PENDING_DELETION: "Pending deletion",
  IN_APPEAL: "In appeal",
  FLAGGED: "Flagged",
  LIMIT_EXCEEDED: "Limit exceeded",
};

export type StatusTone = "ok" | "waiting" | "bad" | "muted";

const TONE_BY_STATUS: Record<string, StatusTone> = {
  APPROVED: "ok",
  PENDING: "waiting",
  IN_APPEAL: "waiting",
  REJECTED: "bad",
  DISABLED: "bad",
  FLAGGED: "bad",
  PAUSED: "muted",
  DELETED: "muted",
  PENDING_DELETION: "muted",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? humanise(status);
}

export function statusTone(status: string): StatusTone {
  return TONE_BY_STATUS[status] ?? "muted";
}

/** Only an approved template can be sent to a customer. */
export function isSendable(status: string): boolean {
  return status === "APPROVED";
}

const VARIABLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * Every distinct `{{token}}` across the given fields, in first-appearance
 * order. Examples must cover these, so the builder and the preview both ask
 * this one function.
 */
export function variablesOf(...texts: (string | null | undefined)[]): string[] {
  const found = new Set<string>();

  for (const text of texts) {
    if (!text) continue;

    for (const match of text.matchAll(VARIABLE)) {
      found.add(match[1]);
    }
  }

  return [...found];
}

/** Replaces each `{{token}}` with its example, leaving unfilled ones visible. */
export function fillVariables(
  text: string,
  examples: Record<string, string>,
): string {
  return text.replace(VARIABLE, (whole, token: string) => {
    const example = examples[token]?.trim();

    return example ? example : whole;
  });
}

/** `16 Nov` — the list shows when the row last changed in Meta. */
export function updatedLabel(iso: string, now = Date.now()): string {
  const at = new Date(iso).getTime();
  const delta = Math.max(0, now - at);
  const hour = 3_600_000;

  if (delta < hour) return `${Math.max(1, Math.floor(delta / 60_000))}m ago`;
  if (delta < 24 * hour) return `${Math.floor(delta / hour)}h ago`;

  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function humanise(status: string): string {
  const words = status.toLowerCase().replace(/_/g, " ");

  return words.charAt(0).toUpperCase() + words.slice(1);
}
