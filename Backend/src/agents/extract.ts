import * as ExcelJS from "exceljs";
import mammoth from "mammoth";

import { ExtractError } from "./ai.errors";

/**
 * Turning an uploaded file into text.
 *
 * Every reader here is pure JavaScript and runs in this process: the Render
 * build stays `npm ci && npm run build` with no LibreOffice, no container and
 * no native module. `.xls` is deliberately absent — `exceljs` reads the
 * zipped `.xlsx` format only.
 */
export const DOCUMENT_EXTENSIONS = [
  "txt",
  "md",
  "csv",
  "docx",
  "xlsx",
  "pdf",
] as const;

export function extensionOf(name: string): string {
  const at = name.lastIndexOf(".");

  return at >= 0 ? name.slice(at + 1).toLowerCase() : "";
}

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

    case "docx":
      return expectText(await docxText(file.bytes), "That document was empty.");

    case "xlsx":
      return expectText(await sheetText(file.bytes), "That workbook was empty.");

    case "xls":
      throw new ExtractError(
        "SOURCE_UNSUPPORTED",
        "The old .xls format cannot be read. Open it in Excel and save it as .xlsx, then upload that.",
      );

    case "pdf":
      return expectText(await pdfText(file.bytes), "That PDF was empty.");

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

  // exceljs bundles its own copy of @types/node, so the `Buffer` it declares is
  // a structurally different type from this project's. The bytes are the same;
  // the cast exists only to satisfy that duplicate declaration.
  await workbook.xlsx.load(
    bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );

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

  const document = await pdfjs
    .getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
    })
    .promise;

  const pages: string[] = [];

  try {
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
    await document.destroy();
  }

  if (pages.length === 0) {
    throw new ExtractError(
      "SOURCE_UNSUPPORTED",
      "That PDF has no text layer, so nothing could be read. It is probably a scan; upload page images or a text export instead.",
    );
  }

  return pages.join("\n\n");
}
