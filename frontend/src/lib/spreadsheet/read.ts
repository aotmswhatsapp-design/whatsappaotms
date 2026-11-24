/**
 * Reading a spreadsheet in the browser.
 *
 * A campaign list arrives as the file a business already keeps: a workbook from
 * Excel, or the same sheet saved as CSV. Neither format needs a library here.
 * CSV is a few lines of parsing. XLSX is a zip of XML, and the browser already
 * owns both halves — `DecompressionStream("deflate-raw")` for the entries and
 * `DOMParser` for the sheet — so the file is read without shipping a parser to
 * every visitor of the workspace.
 *
 * Only the cells are returned, as text, in sheet order. What the columns mean
 * is the campaigns module's business, not this file's.
 */

/** What went wrong, in a sentence the panel can show as it is. */
export class SpreadsheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpreadsheetError";
  }
}

/** Rows past this are refused, because one import is one request. */
export const MAX_SHEET_ROWS = 5_000;

export async function readSpreadsheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".xls")) {
    throw new SpreadsheetError(
      "That is an older .xls workbook. Open it in Excel and save it as .xlsx or .csv, then import that file.",
    );
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    return limit(await readXlsx(await file.arrayBuffer()));
  }

  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return limit(parseDelimited(await file.text()));
  }

  // The extension is the only reliable signal: a browser reports a workbook
  // as `application/octet-stream` on one machine and as its own type on the
  // next. Reading it as CSV is the guess that fails readably.
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());

  if (head[0] === 0x50 && head[1] === 0x4b) {
    return limit(await readXlsx(await file.arrayBuffer()));
  }

  return limit(parseDelimited(await file.text()));
}

function limit(rows: string[][]): string[][] {
  if (rows.length > MAX_SHEET_ROWS + 1) {
    throw new SpreadsheetError(
      `The file has more than ${MAX_SHEET_ROWS.toLocaleString()} rows. Split it and import the parts.`,
    );
  }

  return rows;
}

// ---------------------------------------------------------------------------
// CSV and the delimited formats Excel writes when it is asked for "CSV"
// ---------------------------------------------------------------------------

/**
 * Which separator the sheet uses. Excel in a comma-decimal locale writes `;`,
 * and a tab-separated export is common too, so the first line decides rather
 * than a fixed guess.
 */
function delimiterOf(text: string): string {
  const line = text.split(/\r?\n/).find((entry) => entry.trim().length > 0) ?? "";

  let best = ",";
  let widest = line.split(best).length;

  for (const delimiter of [";", "\t"]) {
    const width = line.split(delimiter).length;

    if (width > widest) {
      widest = width;
      best = delimiter;
    }
  }

  return best;
}

/** Quoted cells may hold the separator, a newline or an escaped quote. */
function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^\ufeff/, "");
  const delimiter = delimiterOf(clean);
  const rows: string[][] = [];

  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];

    if (quoted) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }

      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

async function readXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const entries = await unzip(new Uint8Array(buffer));
  const sheet = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()[0];

  if (!sheet) {
    throw new SpreadsheetError("That workbook has no sheet in it.");
  }

  const sharedEntry = entries.get("xl/sharedStrings.xml");
  const strings = sharedEntry ? sharedStrings(decode(sharedEntry)) : [];

  return sheetRows(decode(entries.get(sheet)!), strings);
}

/** Every sheet cell, by row, as text. Gaps are kept so columns stay aligned. */
function sheetRows(xml: string, shared: string[]): string[][] {
  const doc = parseXml(xml);
  const rows: string[][] = [];

  for (const row of Array.from(doc.getElementsByTagName("row"))) {
    const cells: string[] = [];

    for (const cell of Array.from(row.getElementsByTagName("c"))) {
      const column = columnOf(cell.getAttribute("r"));
      const value = cellValue(cell, shared);

      if (column < 0) {
        cells.push(value);
        continue;
      }

      while (cells.length < column) cells.push("");
      cells[column] = value;
    }

    rows.push(cells);
  }

  return rows;
}

/** `A1` → 0, `AB7` → 27. A cell without a reference is taken in order. */
function columnOf(reference: string | null): number {
  const letters = /^([A-Z]+)/.exec(reference ?? "")?.[1];

  if (!letters) return -1;

  let column = 0;

  for (const letter of letters) {
    column = column * 26 + (letter.charCodeAt(0) - 64);
  }

  return column - 1;
}

/**
 * A number, a shared string or an inline string. Dates and formulas are not
 * interpreted: every column a campaign imports is text, and a value Excel
 * formatted for display is not the value to send.
 */
function cellValue(cell: Element, shared: string[]): string {
  const type = cell.getAttribute("t");

  if (type === "inlineStr") return nodeText(cell, "t") ?? "";

  const raw = nodeText(cell, "v") ?? "";

  return type === "s" ? (shared[Number(raw)] ?? "") : raw;
}

function sharedStrings(xml: string): string[] {
  return Array.from(parseXml(xml).getElementsByTagName("si")).map((entry) =>
    Array.from(entry.getElementsByTagName("t"))
      .map((node) => node.textContent ?? "")
      .join(""),
  );
}

function nodeText(node: Element, tag: string): string | null {
  return node.getElementsByTagName(tag)[0]?.textContent ?? null;
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new SpreadsheetError("The workbook's sheet could not be read.");
  }

  return doc;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * The entries this reader needs, inflated.
 *
 * The zip's own directory is read rather than the local headers: only the
 * central directory carries the real compressed size of every entry, which is
 * what a workbook written by Excel or by Google Sheets both agree on.
 */
async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;

  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 66_000); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }

  if (end < 0) {
    throw new SpreadsheetError(
      "The file is not a readable workbook. Save it as .xlsx or .csv and try again.",
    );
  }

  const count = view.getUint16(end + 10, true);
  const files = new Map<string, Uint8Array>();
  let at = view.getUint32(end + 16, true);

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) break;

    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decode(bytes.subarray(at + 46, at + 46 + nameLength));

    if (/^xl\/(worksheets\/sheet\d+|sharedStrings)\.xml$/.test(name)) {
      const localName = view.getUint16(localAt + 26, true);
      const localExtra = view.getUint16(localAt + 28, true);
      const start = localAt + 30 + localName + localExtra;
      const raw = bytes.subarray(start, start + compressedSize);

      files.set(name, method === 0 ? raw : await inflate(raw, name));
    }

    at += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

async function inflate(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new SpreadsheetError(
      "This browser cannot open .xlsx files. Open the sheet in Excel, save it as CSV, and import that instead.",
    );
  }

  try {
    const stream = new Blob([bytes as unknown as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));

    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new SpreadsheetError(`The workbook could not be opened (${name}).`);
  }
}
