/**
 * Turning a typed or imported list into numbers.
 *
 * The phone number is the only field that decides who gets a message, so it is
 * the only one that can reject a row. Meta addresses a recipient by `wa_id`,
 * which is the number in digits with its country code and nothing else — no
 * plus, no spaces, no brackets — so everything else is stripped here rather
 * than stored and fixed later.
 *
 * Duplicates are the other half of the job: two rows that differ only in
 * punctuation are the same person, and sending twice costs a message and reads
 * like spam. The first row keeps the number; a later row still lends its name,
 * email or reference to it, because a spreadsheet often repeats a customer and
 * fills a different column each time.
 */

/** One row as it arrives from the form or the spreadsheet. */
export interface RecipientInput {
  phone: string;
  name?: string;
  email?: string;
  identity?: string;
}

/** One number, cleaned up, ready for a contact row. */
export interface NormalisedRecipient {
  waId: string;
  name: string | null;
  email: string | null;
  externalId: string | null;
  /** The number as the sheet wrote it, for the table on screen. */
  phoneDisplay: string;
}

/** A row we refuse, with the sentence that explains why. */
export interface InvalidRecipient {
  phone: string;
  reason: string;
}

export interface RecipientImportReport {
  added: number;
  /** Rows in the campaign after this import, so the screen can show a count. */
  total: number;
  duplicates: { count: number; phones: string[] };
  invalid: { count: number; rows: InvalidRecipient[] };
}

/** How many examples travel back; the count is what matters, not the list. */
export const REPORT_SAMPLE = 20;

/**
 * `+91 98765 43210` → `919876543210`.
 *
 * A leading `00` is the international prefix in most of the world and a single
 * leading `0` is a national trunk prefix, so both are dropped: keeping them
 * would address a number that does not exist. Nothing else is guessed — a
 * number without its country code is the workspace's to correct, because
 * inventing a country would send a real message to a stranger.
 */
export function normaliseWaId(raw: string): string | null {
  const compact = raw.trim().replace(/[\s()\-.\u00a0]/g, "");

  if (!/^\+?\d[\d\s()\-.]*$/.test(compact)) return null;

  let digits = compact.replace(/\D/g, "");

  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");

  if (digits.length < 6 || digits.length > 15) return null;

  return digits;
}

function text(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();

  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalise, reject what cannot send, and fold repeated numbers into one row.
 * `entries` is ordered as the sheet was, because the send follows the list.
 */
export function normaliseRecipients(rows: RecipientInput[]): {
  entries: NormalisedRecipient[];
  duplicates: { count: number; phones: string[] };
  invalid: { count: number; rows: InvalidRecipient[] };
} {
  const entries: NormalisedRecipient[] = [];
  const byWaId = new Map<string, NormalisedRecipient>();
  const duplicates: string[] = [];
  const invalid: InvalidRecipient[] = [];

  for (const row of rows) {
    const phone = (row.phone ?? "").trim();

    if (phone.length === 0) {
      invalid.push({ phone, reason: "The row has no phone number." });
      continue;
    }

    const waId = normaliseWaId(phone);

    if (!waId) {
      invalid.push({
        phone,
        reason:
          "Not a usable number. Write it in digits with the country code, for example 919876543210.",
      });
      continue;
    }

    const seen = byWaId.get(waId);

    if (seen) {
      // The number is dropped; the columns it brought are not.
      seen.name ??= text(row.name);
      seen.email ??= text(row.email);
      seen.externalId ??= text(row.identity);
      duplicates.push(waId);
      continue;
    }

    const entry: NormalisedRecipient = {
      waId,
      name: text(row.name),
      email: text(row.email),
      externalId: text(row.identity),
      phoneDisplay: phone,
    };

    byWaId.set(waId, entry);
    entries.push(entry);
  }

  return {
    entries,
    duplicates: { count: duplicates.length, phones: duplicates.slice(0, REPORT_SAMPLE) },
    invalid: { count: invalid.length, rows: invalid.slice(0, REPORT_SAMPLE) },
  };
}
