import { readSpreadsheet, SpreadsheetError } from "@/lib/spreadsheet/read";

/**
 * The campaign's own audience: one row per number.
 *
 * The rules here are the server's rules restated, so the panel can show the
 * count that will actually be sent *before* the request is made — how many rows
 * landed, how many numbers repeated, and which rows had no usable number. The
 * server runs the same cleaning again and its answer is the one that counts.
 */

export interface DraftRecipient {
  name: string;
  email: string;
  phone: string;
  identity: string;
}

export interface ImportReport {
  /** The rows to keep, in sheet order, already deduplicated. */
  rows: DraftRecipient[];
  /** Numbers that repeated — in the file, or already in the campaign. */
  duplicates: { count: number; phones: string[] };
  invalid: { count: number; rows: { phone: string; reason: string }[] };
}

/** How many examples the panel lists; the count is the part that matters. */
const SAMPLE = 20;

/** Column names a business might already have in its sheet. */
const COLUMNS: Record<keyof DraftRecipient, string[]> = {
  name: ["name", "full name", "fullname", "customer", "customer name", "contact name"],
  email: ["email", "e-mail", "email address", "email id", "mail"],
  phone: [
    "phone",
    "phone number",
    "phone no",
    "mobile",
    "mobile number",
    "whatsapp",
    "whatsapp number",
    "contact number",
    "number",
    "wa_id",
    "wa id",
  ],
  identity: [
    "identity",
    "id",
    "external id",
    "external_id",
    "customer id",
    "reference",
    "member id",
  ],
};

/**
 * `+91 98765 43210` → `919876543210`, exactly as the server does it: one
 * leading `00` is an international prefix, one leading `0` a national trunk
 * prefix, and both would address a number that does not exist.
 */
export function normalisePhone(raw: string): string | null {
  const compact = raw.trim().replace(/[\s()\-.\u00a0]/g, "");

  if (!/^\+?\d[\d\s()\-.]*$/.test(compact)) return null;

  let digits = compact.replace(/\D/g, "");

  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");

  return digits.length >= 6 && digits.length <= 15 ? digits : null;
}

/**
 * Drop repeated numbers and refuse rows that cannot be messaged. `known` holds
 * the numbers the campaign already has, so re-importing a file adds nothing and
 * says so instead of quietly doubling the audience.
 */
export function dedupeRecipients(
  rows: DraftRecipient[],
  known: Set<string> = new Set(),
): ImportReport {
  const kept: DraftRecipient[] = [];
  const seen = new Map<string, DraftRecipient>();
  const duplicates: string[] = [];
  const invalid: { phone: string; reason: string }[] = [];

  for (const row of rows) {
    const phone = row.phone.trim();

    if (phone.length === 0) {
      invalid.push({ phone, reason: "The row has no phone number." });
      continue;
    }

    const waId = normalisePhone(phone);

    if (!waId) {
      invalid.push({
        phone,
        reason:
          "Not a usable number. Write it in digits with the country code, for example 919876543210.",
      });
      continue;
    }

    const existing = seen.get(waId);

    if (existing) {
      // The number goes; the columns it brought do not.
      existing.name ||= row.name.trim();
      existing.email ||= row.email.trim();
      existing.identity ||= row.identity.trim();
      duplicates.push(phone);
      continue;
    }

    if (known.has(waId)) {
      duplicates.push(phone);
      continue;
    }

    const entry: DraftRecipient = {
      name: row.name.trim(),
      email: row.email.trim(),
      phone,
      identity: row.identity.trim(),
    };

    seen.set(waId, entry);
    kept.push(entry);
  }

  return {
    rows: kept,
    duplicates: { count: duplicates.length, phones: duplicates.slice(0, SAMPLE) },
    invalid: { count: invalid.length, rows: invalid.slice(0, SAMPLE) },
  };
}

/**
 * Read a workbook or a CSV into rows. The header decides the columns; a sheet
 * with one column is a list of numbers, and anything else follows the template
 * order: name, email, phone, identity.
 *
 * `known` is every number the campaign already has, staged or saved, so the
 * count on screen excludes what the import would only repeat.
 */
export async function readRecipientFile(
  file: File,
  known: Set<string> = new Set(),
): Promise<ImportReport> {
  const table = await readSpreadsheet(file);

  return dedupeRecipients(recipientRows(table), known);
}

function recipientRows(table: string[][]): DraftRecipient[] {
  const filled = table.filter((row) => row.some((cell) => cell.trim().length > 0));

  if (filled.length === 0) {
    throw new SpreadsheetError("The file has no rows in it.");
  }

  const header = columnsOf(filled[0]);

  if (header) {
    if (header.phone === undefined) {
      throw new SpreadsheetError(
        "The sheet needs a phone column. Add a header named phone (or mobile or whatsapp).",
      );
    }

    return filled.slice(1).map((row) => ({
      name: cellOf(row, header.name),
      email: cellOf(row, header.email),
      phone: cellOf(row, header.phone),
      identity: cellOf(row, header.identity),
    }));
  }

  const single = filled.every(
    (row) => row.filter((cell) => cell.trim().length > 0).length === 1,
  );

  if (single) {
    return filled.map((row) => ({
      name: "",
      email: "",
      phone: row.find((cell) => cell.trim().length > 0)?.trim() ?? "",
      identity: "",
    }));
  }

  // No header, more than one column: read it the way the template is laid out.
  return filled.map((row) => ({
    name: cellOf(row, 0),
    email: cellOf(row, 1),
    phone: cellOf(row, 2),
    identity: cellOf(row, 3),
  }));
}

/** The first row, read as a header, or null when it is already data. */
function columnsOf(row: string[]): Partial<Record<keyof DraftRecipient, number>> | null {
  const found: Partial<Record<keyof DraftRecipient, number>> = {};

  row.forEach((cell, index) => {
    const name = cell.trim().toLowerCase().replace(/\s+/g, " ");

    for (const key of Object.keys(COLUMNS) as (keyof DraftRecipient)[]) {
      if (found[key] === undefined && COLUMNS[key].includes(name)) {
        found[key] = index;
        return;
      }
    }
  });

  return Object.keys(found).length > 0 ? found : null;
}

function cellOf(row: string[], index: number | undefined): string {
  return index === undefined ? "" : (row[index] ?? "").trim();
}

/** The file the panel offers: the headers it expects, and two example rows. */
export function recipientTemplate(): string {
  return [
    "name,email,phone,identity",
    "Ravi Kumar,ravi@example.com,919876543210,CUST-1042",
    "Meera Nair,meera@example.com,+91 98860 12345,CUST-1043",
  ].join("\r\n");
}
