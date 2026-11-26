import { Logger } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import mammoth from "mammoth";

import { ExtractError } from "./ai.errors";
import { extensionOf } from "./knowledge.file";

const logger = new Logger("Extract");

/**
 * Turning an uploaded file into text.
 *
 * Every reader here is pure JavaScript and runs in this process: the Render
 * build stays `npm ci && npm run build` with no LibreOffice, no container and
 * no native module. `.xls` is deliberately absent — `exceljs` reads the
 * zipped `.xlsx` format only.
 *
 * Text leaves here as blocks, not as one string: a page number or a heading is
 * evidence of where an answer came from, and joining pages erases it.
 *
 * The extension allowlist lives in `knowledge.file.ts`, beside the signature
 * check that has to agree with it.
 */
export interface SourceBlock {
  text: string;
  page?: number;
  sheet?: string;
  /**
   * The first and last row this block covers, in the file's own numbering:
   * a worksheet row for XLSX, a record number for CSV. Blank rows keep their
   * place, so a block that skips row 12 still says which rows it really spans.
   * Not the position of the row inside the block.
   */
  rowFrom?: number;
  rowTo?: number;
  heading?: string;
}

/** A CSV has no sheet, so it is indexed under this name; a citation reads it
 *  as "records", because a quoted line break makes records and lines differ. */
export const CSV_SHEET = "CSV";

/** What `knowledge.file.ts` records for a `.csv` upload, whatever the browser
 *  claimed. A citation decides "CSV" by this and never by the sheet name: a
 *  workbook may hold a worksheet called `CSV`, and that is still a workbook. */
export const CSV_MIME = "text/csv";

/** A row carrying its own number in the file, so blanks never renumber it. */
export interface TableRow {
  number: number;
  cells: string[];
}

export type TableMeta = {
  kind: "table";
  sheets: { name: string; headers: string[]; rowCount: number }[];
};

/** The pages that carry text: a blank page is not one a citation can name. */
export type DocumentMeta = { kind: "document"; pages: number | null };

/** An image's own type and pixel size, read from its bytes before it is read. */
export type ImageMeta = {
  kind: "image";
  mime: string;
  width: number | null;
  height: number | null;
};

/** What the row knows about a source's shape, whatever kind of source it is. */
export type ExtractedMeta = TableMeta | DocumentMeta | ImageMeta;

export interface Extracted {
  blocks: SourceBlock[];
  meta: ExtractedMeta | null;
}

/** 20 rows per block: enough to be a paragraph of meaning, small enough that
 *  a retrieved chunk is still one answer's worth of rows. */
const ROWS_PER_BLOCK = 20;

export async function extractSource(file: {
  bytes: Buffer;
  mime: string;
  name: string;
}): Promise<Extracted> {
  const extension = extensionOf(file.name);

  switch (extension) {
    case "txt":
      return {
        blocks: [{ text: expectText(decode(file.bytes), "That file was empty.") }],
        meta: null,
      };

    case "md":
      return {
        blocks: expectBlocks(markdownBlocks(decode(file.bytes)), "That file was empty."),
        meta: null,
      };

    case "csv": {
      const parsed = csvBlocks(parseCsv(decode(file.bytes)));
      return {
        blocks: expectBlocks(parsed.blocks, "That CSV was empty."),
        meta: parsed.meta,
      };
    }

    case "docx":
      return {
        blocks: expectBlocks(await readable(() => docxBlocks(file.bytes), file.name), "That document was empty."),
        meta: null,
      };

    case "xlsx": {
      const parsed = await readable(() => xlsxBlocks(file.bytes), file.name);
      return {
        blocks: expectBlocks(parsed.blocks, "That workbook was empty."),
        meta: parsed.meta,
      };
    }

    case "pdf": {
      const blocks = await readable(() => pdfBlocks(file.bytes), file.name);

      return {
        blocks,
        meta: { kind: "document", pages: blocks.length },
      };
    }

    case "xls":
      throw new ExtractError(
        "SOURCE_UNSUPPORTED",
        "The old .xls format cannot be read. Open it in Excel and save it as .xlsx, then upload that.",
      );

    default:
      throw new ExtractError(
        "SOURCE_UNSUPPORTED",
        `A ${extension ? `.${extension}` : "file of that type"} is not one the agent can read.`,
      );
  }
}

function expectBlocks(blocks: SourceBlock[], sentence: string): SourceBlock[] {
  if (blocks.every((block) => block.text.trim().length === 0)) {
    throw new ExtractError("SOURCE_EMPTY", sentence);
  }

  return blocks.filter((block) => block.text.trim().length > 0);
}

/** Kept for callers that want one string; the pipeline uses blocks. */
export async function extractDocument(file: {
  bytes: Buffer;
  mime: string;
  name: string;
}): Promise<string> {
  return (await extractSource(file)).blocks.map((block) => block.text).join("\n\n");
}

/** UTF-8, with the byte-order mark an exported CSV often carries. */
function decode(bytes: Buffer): string {
  return bytes.toString("utf8").replace(/^\uFEFF/, "").trim();
}

function expectText(text: string, sentence: string): string {
  const trimmed = text.trim();

  if (trimmed.length === 0) throw new ExtractError("SOURCE_EMPTY", sentence);

  return trimmed;
}

/**
 * A parser's own failure — corrupt bytes, a password, a format the library
 * cannot read after all — is a refusal about the file, not a bug in this
 * module. The detail goes to the log, where an operator can act on it; the
 * caller gets a code the upload route can turn into a sentence.
 */
async function readable<T>(
  run: () => Promise<T>,
  name: string,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ExtractError) throw error;

    logger.warn(
      `Could not read ${name}: ${error instanceof Error ? error.message : "unknown failure"}`,
    );

    throw new ExtractError(
      "SOURCE_UNSUPPORTED",
      "That file could not be read. It may be corrupt, password-protected, or not really the format its name says.",
    );
  }
}

export function pagesToBlocks(pages: string[]): SourceBlock[] {
  return pages.flatMap((text, index) => (text.length > 0 ? [{ text, page: index + 1 }] : []));
}

/**
 * A state machine over the whole text, RFC 4180 in the parts that change data:
 * a quote opens a value and appears nowhere else, `""` inside a quoted value
 * is one quote, and a comma or a line break inside quotes is content. A record
 * ends only at a line break outside quotes, which is what makes record numbers
 * mean the same thing to a reader as they do to this parser.
 *
 * Spaces around an unquoted value are trimmed, since spreadsheets add them by
 * accident. A quoted value is kept exactly as written.
 *
 * A quote where RFC 4180 does not allow one is a refusal: repairing it would
 * silently move values into neighbouring columns.
 */
export function parseCsv(raw: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  let line = 1;

  const endField = () => {
    record.push(quoted ? cell : cell.trim());
    cell = "";
    quoted = false;
    state = "start";
  };

  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  for (let at = 0; at < raw.length; at += 1) {
    const char = raw[at];

    if (state === "quoted") {
      if (char === '"') {
        if (raw[at + 1] === '"') { cell += '"'; at += 1; }
        else state = "closed";
        continue;
      }

      if (char === "\r" || char === "\n") {
        if (char === "\r" && raw[at + 1] === "\n") at += 1;
        cell += "\n";
        line += 1;
        continue;
      }

      cell += char;
      continue;
    }

    if (state === "closed") {
      if (char === ",") { endField(); continue; }
      if (char === "\r" || char === "\n") {
        if (char === "\r" && raw[at + 1] === "\n") at += 1;
        endRecord();
        line += 1;
        continue;
      }

      throw malformedCsv(line, "a closing quote must be followed by a comma or the end of the line");
    }

    if (char === '"') {
      if (state !== "start") {
        throw malformedCsv(line, "a quote may only open a value, so wrap the whole value in quotes");
      }
      state = "quoted";
      quoted = true;
      continue;
    }

    if (char === ",") { endField(); continue; }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && raw[at + 1] === "\n") at += 1;
      endRecord();
      line += 1;
      continue;
    }

    state = "plain";
    cell += char;
  }

  if (state === "quoted") {
    throw malformedCsv(line, "a quoted value was never closed");
  }

  if (state !== "start" || record.length > 0) endRecord();

  return records;
}

function malformedCsv(line: number, detail: string): ExtractError {
  return new ExtractError(
    "SOURCE_UNSUPPORTED",
    `That CSV could not be read: ${detail} (line ${line}). A value containing a comma, a quote or a line break belongs inside double quotes, and a quote inside such a value is written as two quotes.`,
  );
}

/** One block per run of rows, headers repeated, the covered rows recorded.
 *  Empty cells are kept so every value stays under its own column. */
export function sheetBlocks(name: string, headers: string[], rows: TableRow[]): SourceBlock[] {
  // A loop, not `Math.max(...rows.map(...))`: a quarter of a million rows
  // overflow the argument stack, and a CSV that large is inside the limit.
  let width = headers.length;
  for (const row of rows) if (row.cells.length > width) width = row.cells.length;

  const head = `Columns: ${Array.from({ length: width }, (_, at) => headers[at] ?? "").join(" | ")}`;

  return Array.from({ length: Math.ceil(rows.length / ROWS_PER_BLOCK) }, (_, block) => {
    const from = block * ROWS_PER_BLOCK;
    const slice = rows.slice(from, from + ROWS_PER_BLOCK);
    const lines = slice.map((row) => Array.from({ length: width }, (_, at) => row.cells[at] ?? "").join(" | "));

    return {
      text: `${head}\n${lines.join("\n")}`,
      sheet: name,
      // The rows' own numbers, not their positions in this block.
      rowFrom: slice[0].number,
      rowTo: slice[slice.length - 1].number,
    };
  });
}

export function csvBlocks(records: string[][]): { blocks: SourceBlock[]; meta: TableMeta } {
  // The header is the first record that carries anything, and every record
  // keeps the number it has in the file from there. A blank record is still a
  // record: dropping it would move every citation after it onto the wrong one.
  const head = records.findIndex((cells) => cells.some((value) => value.length > 0));
  const headers = head >= 0 ? records[head] : [];

  const data = records
    .slice(head + 1)
    .map((cells, at) => ({ number: head + at + 2, cells }))
    .filter((row) => row.cells.some((value) => value.length > 0));

  return {
    blocks: sheetBlocks(CSV_SHEET, headers, data),
    meta: { kind: "table", sheets: [{ name: CSV_SHEET, headers, rowCount: data.length }] },
  };
}

/** h1-h6, paragraphs and table rows, in document order. Mammoth wraps a cell
 *  body in its own <p>, so tables are matched as a whole before paragraphs. */
export function docxHtmlToBlocks(html: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  let heading: string | undefined;
  const token = /<table[\s\S]*?<\/table>|<h([1-6])[^>]*>([\s\S]*?)<\/h\1>|<p[^>]*>([\s\S]*?)<\/p>/gi;

  for (const match of html.matchAll(token)) {
    if (match[0].startsWith("<table")) {
      for (const row of match[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => plain(cell[1]));
        if (cells.length > 0) blocks.push(heading ? { text: cells.join(" | "), heading } : { text: cells.join(" | ") });
      }
      continue;
    }

    const text = plain(match[1] ? match[2] : match[3]);
    if (text.length === 0) continue;

    if (match[1]) {
      heading = text;
      blocks.push({ text, heading });
    } else {
      blocks.push(heading ? { text, heading } : { text });
    }
  }

  return blocks;
}

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function docxBlocks(bytes: Buffer): Promise<SourceBlock[]> {
  const html = await mammoth.convertToHtml({ buffer: bytes });
  const blocks = docxHtmlToBlocks(html.value);

  if (blocks.length > 0) return blocks;

  // A document mammoth cannot convert still has paragraphs; do not lose them.
  const raw = await mammoth.extractRawText({ buffer: bytes });
  return raw.value.split(/\n{2,}/).map((text) => ({ text: text.trim() })).filter((block) => block.text.length > 0);
}

/** A markdown heading owns the text beneath it. */
function markdownBlocks(text: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  let heading: string | undefined;
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body.length > 0) blocks.push(heading ? { text: body, heading } : { text: body });
    buffer = [];
  };

  for (const line of text.split("\n")) {
    const found = /^#{1,6}\s+(.+)$/.exec(line);

    if (found) {
      flush();
      heading = found[1].trim();
      blocks.push({ text: heading, heading });
      continue;
    }

    buffer.push(line);
  }

  flush();
  return blocks;
}

/** Headers from row 1, data from row 2, every column read so an empty cell
 *  keeps its place under the right header. */
async function xlsxBlocks(bytes: Buffer): Promise<{ blocks: SourceBlock[]; meta: TableMeta }> {
  const workbook = new ExcelJS.Workbook();

  // exceljs declares `interface Buffer extends ArrayBuffer {}` of its own, so
  // the parameter is an ArrayBuffer rather than Node's Buffer. A fresh view
  // hands it exactly that, with no assertion and no reliance on the two
  // `Buffer` declarations lining up.
  await workbook.xlsx.load(new Uint8Array(bytes).buffer);

  const blocks: SourceBlock[] = [];
  const sheets: TableMeta["sheets"] = [];

  for (const sheet of workbook.worksheets) {
    const rows: TableRow[] = [];
    let width = 0;

    sheet.eachRow({ includeEmpty: false }, (row) => {
      width = Math.max(width, row.cellCount);
      const cells: string[] = [];
      for (let column = 1; column <= row.cellCount; column += 1) cells.push(String(row.getCell(column).text ?? "").trim());
      // `row.number` is the worksheet's own number, so a blank row leaves a
      // hole in the numbering instead of shifting everything after it.
      rows.push({ number: row.number, cells });
    });

    if (rows.length === 0) continue;

    const padded = rows.map((row) => ({
      number: row.number,
      cells: Array.from({ length: width }, (_, at) => row.cells[at] ?? ""),
    }));

    const [first, ...rest] = padded;
    const headers = first?.cells ?? [];
    const data = rest.filter((row) => row.cells.some((value) => value.length > 0));

    blocks.push(...sheetBlocks(sheet.name, headers, data));
    sheets.push({ name: sheet.name, headers, rowCount: data.length });
  }

  if (blocks.length === 0) {
    throw new ExtractError("SOURCE_EMPTY", "That workbook was empty.");
  }

  return { blocks, meta: { kind: "table", sheets } };
}

/**
 * The text layer only. No page is rendered, so no canvas is needed — and a
 * scanned PDF, which has no text layer, cannot be read at all until a renderer
 * exists. It says so instead of indexing nothing.
 */
async function pdfBlocks(bytes: Buffer): Promise<SourceBlock[]> {
  const pdfjs = await import("pdfjs-dist");

  // The loading task is what owns the worker, so it is the thing to destroy —
  // and it must be destroyed even when loading itself rejects.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
  });

  const pages: string[] = [];

  try {
    const document = await task.promise;

    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();

      const line = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      // Pushed even when empty: the index of the array is the page number.
      pages.push(line);

      page.cleanup();
    }
  } finally {
    await task.destroy();
  }

  const blocks = pagesToBlocks(pages);

  if (blocks.length === 0) {
    throw new ExtractError(
      "SOURCE_UNSUPPORTED",
      "That PDF has no text layer, so nothing could be read. It is probably a scan; upload page images or a text export instead.",
    );
  }

  return blocks;
}
