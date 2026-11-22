/**
 * Meta's vocabulary, in the words the screen uses.
 *
 * Everything here renders after a client fetch, so locale-dependent formatting
 * is safe: there is no server pass to disagree with.
 */

import { formatMoney } from "@/lib/money";

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

/**
 * The pill and its dot, in the palette the rest of the workspace uses. Shared
 * by every place that shows a review state, so the catalogue and the detail
 * screen cannot drift into two different greens.
 */
export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  ok: "border-lime/45 bg-lime/10 text-foreground",
  waiting: "border-warning/45 bg-warning/10 text-foreground",
  bad: "border-destructive/35 bg-destructive/10 text-foreground",
  muted: "border-border bg-secondary text-muted-foreground",
};

export const STATUS_TONE_DOT: Record<StatusTone, string> = {
  ok: "bg-lime",
  waiting: "bg-warning",
  bad: "bg-destructive",
  muted: "bg-muted-foreground/60",
};

/** `1,284` — a count, or an em dash when nobody measured it. */
export function countLabel(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString();
}

/**
 * Money in Meta's own currency. A null is an em dash: Meta withholds cost under
 * some billing arrangements, and "0.00" would read as "this was free". When the
 * currency itself is unknown the digits are shown bare — the shared formatter
 * refuses to invent a symbol.
 */
export function moneyLabel(
  value: number | null | undefined,
  currency: string | null,
): string {
  return formatMoney(value, currency);
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
