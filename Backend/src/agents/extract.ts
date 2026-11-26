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
  rowFrom?: number;
  rowTo?: number;
  heading?: string;
}

export type TableMeta = {
  kind: "table";
  sheets: { name: string; headers: string[]; rowCount: number }[];
};

export interface Extracted {
  blocks: SourceBlock[];
  meta: TableMeta | null;
  /** Tokens spent reading an image or a voice note; 0 for documents. */
  extractTokens: number;
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
        extractTokens: 0,
      };

    case "md":
      return {
        blocks: expectBlocks(markdownBlocks(decode(file.bytes)), "That file was empty."),
        meta: null,
        extractTokens: 0,
      };

    case "csv": {
      const parsed = csvBlocks(parseCsv(decode(file.bytes)));
      return {
        blocks: expectBlocks(parsed.blocks, "That CSV was empty."),
        meta: parsed.meta,
        extractTokens: 0,
      };
    }

    case "docx":
      return {
        blocks: expectBlocks(await readable(() => docxBlocks(file.bytes), file.name), "That document was empty."),
        meta: null,
        extractTokens: 0,
      };

    case "xlsx": {
      const parsed = await readable(() => xlsxBlocks(file.bytes), file.name);
      return {
        blocks: expectBlocks(parsed.blocks, "That workbook was empty."),
        meta: parsed.meta,
        extractTokens: 0,
      };
    }

    case "pdf":
      return {
        blocks: await readable(() => pdfBlocks(file.bytes), file.name),
        meta: null,
        extractTokens: 0,
      };

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

/** A state machine over the whole text: a comma inside quotes is data, and a
 *  newline inside quotes is still the same cell. */
export function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let at = 0; at < raw.length; at += 1) {
    const char = raw[at];

    if (quoted) {
      if (char === '"') {
        if (raw[at + 1] === '"') { cell += '"'; at += 1; }
        else quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(cell.trim()); cell = ""; continue; }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && raw[at + 1] === "\n") at += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) { row.push(cell.trim()); rows.push(row); }

  return rows.filter((line) => line.some((value) => value.length > 0));
}

/** One block per run of rows, headers repeated, row range recorded. Empty
 *  cells are kept so every value stays under its own column. */
export function sheetBlocks(name: string, headers: string[], rows: string[][]): SourceBlock[] {
  // A loop, not `Math.max(...rows.map(...))`: a quarter of a million rows
  // overflow the argument stack, and a CSV that large is inside the limit.
  let width = headers.length;
  for (const row of rows) if (row.length > width) width = row.length;

  const head = `Columns: ${Array.from({ length: width }, (_, at) => headers[at] ?? "").join(" | ")}`;

  return Array.from({ length: Math.ceil(rows.length / ROWS_PER_BLOCK) }, (_, block) => {
    const from = block * ROWS_PER_BLOCK;
    const slice = rows.slice(from, from + ROWS_PER_BLOCK);
    const lines = slice.map((row) => Array.from({ length: width }, (_, at) => row[at] ?? "").join(" | "));

    return {
      text: `${head}\n${lines.join("\n")}`,
      sheet: name,
      rowFrom: from + 1,
      rowTo: from + slice.length,
    };
  });
}

export function csvBlocks(rows: string[][]): { blocks: SourceBlock[]; meta: TableMeta } {
  const headers = rows[0] ?? [];
  const data = rows.slice(1);

  return {
    blocks: sheetBlocks("CSV", headers, data),
    meta: { kind: "table", sheets: [{ name: "CSV", headers, rowCount: data.length }] },
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
    const rows: string[][] = [];
    let width = 0;

    sheet.eachRow({ includeEmpty: false }, (row) => {
      width = Math.max(width, row.cellCount);
      const cells: string[] = [];
      for (let column = 1; column <= row.cellCount; column += 1) cells.push(String(row.getCell(column).text ?? "").trim());
      rows.push(cells);
    });

    if (rows.length === 0) continue;

    const padded = rows.map((row) => Array.from({ length: width }, (_, at) => row[at] ?? ""));
    const headers = padded[0] ?? [];
    const data = padded.slice(1);

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
