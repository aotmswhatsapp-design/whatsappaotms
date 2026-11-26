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
 * The extension allowlist lives in `knowledge.file.ts`, beside the signature
 * check that has to agree with it.
 */
export async function extractDocument(file: {
  bytes: Buffer;
  mime: string;
  name: string;
}): Promise<string> {
  const extension = extensionOf(file.name);

  switch (extension) {
    case "txt":
    case "md":
      return expectText(decode(file.bytes), "That file was empty.");

    case "csv":
      return expectText(csvToText(decode(file.bytes)), "That CSV was empty.");

    case "docx": {
      const text = await readable(() => docxText(file.bytes), file.name);
      return expectText(text, "That document was empty.");
    }

    case "xlsx": {
      const text = await readable(() => sheetText(file.bytes), file.name);
      return expectText(text, "That workbook was empty.");
    }

    case "xls":
      throw new ExtractError(
        "SOURCE_UNSUPPORTED",
        "The old .xls format cannot be read. Open it in Excel and save it as .xlsx, then upload that.",
      );

    case "pdf": {
      const text = await readable(() => pdfText(file.bytes), file.name);
      return expectText(text, "That PDF was empty.");
    }

    default:
      throw new ExtractError(
        "SOURCE_UNSUPPORTED",
        `A ${extension ? `.${extension}` : "file of that type"} is not one the agent can read.`,
      );
  }
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
async function readable(
  run: () => Promise<string>,
  name: string,
): Promise<string> {
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

/**
 * A CSV loses its meaning when the commas stay in: "Delivery,50" reads as one
 * phrase. Cells joined with a separator read as a row, which is what a person
 * asking "how much is delivery" is searching for. Quoted cells are respected.
 */
function csvToText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => cellsOf(line).join(" | ").trim())
    .filter((line) => line.replace(/\|/g, "").trim().length > 0)
    .join("\n");
}

function cellsOf(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      // A doubled quote inside a quoted cell is one literal quote.
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += char;
  }

  cells.push(cell.trim());

  return cells.filter((value) => value.length > 0);
}

async function docxText(bytes: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: bytes });

  return result.value.trim();
}

/** One heading per sheet, then each row's cells on one line. */
async function sheetText(bytes: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();

  // exceljs declares `interface Buffer extends ArrayBuffer {}` of its own, so
  // the parameter is an ArrayBuffer rather than Node's Buffer. A fresh view
  // hands it exactly that, with no assertion and no reliance on the two
  // `Buffer` declarations lining up.
  await workbook.xlsx.load(new Uint8Array(bytes).buffer);

  const sheets: string[] = [];

  for (const sheet of workbook.worksheets) {
    const lines: string[] = [];

    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];

      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = String(cell.text ?? "").trim();
        if (text.length > 0) cells.push(text);
      });

      if (cells.length > 0) lines.push(cells.join(" | "));
    });

    if (lines.length > 0) sheets.push(`## ${sheet.name}\n${lines.join("\n")}`);
  }

  return sheets.join("\n\n");
}

/**
 * The text layer only. No page is rendered, so no canvas is needed — and a
 * scanned PDF, which has no text layer, cannot be read at all until a renderer
 * exists. It says so instead of indexing nothing.
 */
async function pdfText(bytes: Buffer): Promise<string> {
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

      if (line.length > 0) pages.push(line);

      page.cleanup();
    }
  } finally {
    await task.destroy();
  }

  if (pages.length === 0) {
    throw new ExtractError(
      "SOURCE_UNSUPPORTED",
      "That PDF has no text layer, so nothing could be read. It is probably a scan; upload page images or a text export instead.",
    );
  }

  return pages.join("\n\n");
}
