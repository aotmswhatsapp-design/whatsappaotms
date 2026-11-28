import assert from "node:assert/strict";
import { test } from "node:test";
import * as ExcelJS from "exceljs";

import { ExtractError } from "./extract.errors";
import {
  CSV_SHEET,
  csvBlocks,
  docxHtmlToBlocks,
  extractSource,
  mergePages,
  OCR_MAX_PAGES,
  pagesNeedingOcr,
  pagesToBlocks,
  parseCsv,
} from "./extract";

/** An xlsx whose rows sit at the numbers given, so gaps are real gaps. */
const sheetWith = async (name: string, rows: [number, string[]][]) => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(name);

  for (const [number, cells] of rows) {
    cells.forEach((value, at) => { sheet.getCell(number, at + 1).value = value; });
  }

  return Buffer.from(await book.xlsx.writeBuffer());
};

test("each PDF page is its own block, numbered from one", () => {
  assert.deepEqual(pagesToBlocks(["first", "", "third"]), [
    { text: "first", page: 1 },
    { text: "third", page: 3 },
  ]);
});

test("a quoted comma and a quoted newline stay inside one cell", () => {
  const rows = parseCsv('name,address\n"Doe, J","12 Main\nPune"\n');
  assert.deepEqual(rows, [["name", "address"], ["Doe, J", "12 Main\nPune"]]);
});

test("empty cells keep their column", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,,3\n"), [["a", "b", "c"], ["1", "", "3"]]);
});

test("an escaped double quote is one quote inside the value", () => {
  assert.deepEqual(parseCsv('a\n"he said ""hi"""\n'), [["a"], ['he said "hi"']]);
});

test("a quote inside an unquoted value is refused, naming the line", () => {
  assert.throws(
    () => parseCsv('size,item\n5" pipe,wrench\n'),
    (error: unknown) =>
      error instanceof ExtractError &&
      error.code === "SOURCE_UNSUPPORTED" &&
      /line 2/.test(error.message),
  );
});

test("a quoted value that is never closed is refused", () => {
  assert.throws(
    () => parseCsv('size\n"5\n'),
    (error: unknown) => error instanceof ExtractError && /never closed/.test(error.message),
  );
});

test("text after a closing quote is refused rather than merged into the value", () => {
  assert.throws(
    () => parseCsv('size\n"5"mm\n'),
    (error: unknown) => error instanceof ExtractError && /closing quote/.test(error.message),
  );
});

test("every CSV block repeats the headers and reports its own row range", () => {
  const rows = [["item", "price"]];
  for (let index = 1; index <= 45; index += 1) rows.push([`item ${index}`, String(index * 10)]);

  const { blocks, meta } = csvBlocks(rows);

  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((block) => [block.rowFrom, block.rowTo]), [[2, 21], [22, 41], [42, 46]]);
  assert.ok(blocks.every((block) => block.text.startsWith("Columns: item | price")));
  assert.ok(blocks[0].text.includes("item 1 | 10"));
  assert.deepEqual(meta, { kind: "table", sheets: [{ name: CSV_SHEET, headers: ["item", "price"], rowCount: 45 }] });
});

test("a blank record keeps its number, so the rows after it stay on their own line", () => {
  const { blocks } = csvBlocks(parseCsv("item,price\nrice,449\n\nsoap,20\n"));

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].rowFrom, 2);
  assert.equal(blocks[0].rowTo, 4);
  assert.deepEqual(blocks[0].text.split("\n"), [
    "Columns: item | price",
    "rice | 449",
    "soap | 20",
  ]);
});

test("a quoted line break does not start a new record", () => {
  const { blocks } = csvBlocks(parseCsv('item,notes\nrice,"one\ntwo"\nsoap,three\n'));

  assert.equal(blocks[0].rowFrom, 2);
  assert.equal(blocks[0].rowTo, 3);
  assert.ok(blocks[0].text.includes("rice | one\ntwo"));
});

test("data after leading blank records reports the record it is really on", () => {
  const { blocks } = csvBlocks(parseCsv("item,price\n\n\nrice,449\n"));

  assert.equal(blocks[0].rowFrom, 4);
  assert.equal(blocks[0].rowTo, 4);
});

test("a work out sheet keeps its name, headers and empty columns", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Wholesale");
  sheet.addRow(["item", "", "price"]);
  sheet.addRow(["rice", "", "449"]);
  const bytes = Buffer.from(await book.xlsx.writeBuffer());

  const { blocks, meta } = await extractSource({ bytes, mime: "text/csv", name: "rates.xlsx" });

  assert.equal(blocks[0].sheet, "Wholesale");
  assert.ok(blocks[0].text.includes("Columns: item |  | price"));
  assert.ok(blocks[0].text.includes("rice |  | 449"));
  assert.equal(meta?.kind, "table");
});

test("worksheet row numbers survive blank rows and a late header", async () => {
  const bytes = await sheetWith("Rates", [
    [3, ["item", "price"]],
    [5, ["rice", "449"]],
    [6, ["soap", "20"]],
  ]);

  const { blocks } = await extractSource({ bytes, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: "rates.xlsx" });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].sheet, "Rates");
  assert.equal(blocks[0].rowFrom, 5);
  assert.equal(blocks[0].rowTo, 6);
});

test("a blank row inside a sheet does not renumber the rows below it", async () => {
  const bytes = await sheetWith("Rates", [
    [1, ["item", "price"]],
    [2, ["rice", "449"]],
    [4, ["soap", "20"]],
  ]);

  const { blocks } = await extractSource({ bytes, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: "rates.xlsx" });

  assert.equal(blocks[0].rowFrom, 2);
  assert.equal(blocks[0].rowTo, 4);
  assert.deepEqual(blocks[0].text.split("\n"), ["Columns: item | price", "rice | 449", "soap | 20"]);
});

test("a worksheet named CSV keeps its own name, so it cannot be mistaken for a CSV file", async () => {
  const bytes = await sheetWith("CSV", [
    [1, ["item", "price"]],
    [2, ["rice", "449"]],
  ]);

  const { blocks, meta } = await extractSource({
    bytes,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    name: "rates.xlsx",
  });

  assert.equal(blocks[0].sheet, CSV_SHEET);
  assert.equal(blocks[0].rowFrom, 2);
  assert.ok(meta && meta.kind === "table");
  assert.equal(meta.sheets[0].name, CSV_SHEET);
});

test("a docx heading attaches to the paragraph beneath it", () => {
  const html = "<h2>Delivery</h2><p>Pune in 24 hours.</p><p>Elsewhere 2-3 days.</p>";
  const blocks = docxHtmlToBlocks(html);

  assert.deepEqual(blocks[0], { text: "Delivery", heading: "Delivery" });
  assert.equal(blocks[1].text, "Pune in 24 hours.");
  assert.equal(blocks[1].heading, "Delivery");
});

test("a docx table becomes one line per row, cells separated", () => {
  const html = "<table><tr><td>item</td><td>price</td></tr><tr><td>rice</td><td>449</td></tr></table>";
  const blocks = docxHtmlToBlocks(html);

  assert.deepEqual(blocks.map((block) => block.text), ["item | price", "rice | 449"]);
});

test("an empty text file is a refusal, not an empty index", async () => {
  await assert.rejects(
    () => extractSource({ bytes: Buffer.from("  \n "), mime: "text/plain", name: "notes.txt" }),
    (error: unknown) => error instanceof ExtractError && error.code === "SOURCE_EMPTY",
  );
});

/** Long enough to be a page that speaks for itself. */
const PAGE = "Price list for the season, inclusive of taxes and delivery charges.";

/**
 * A valid PDF with no content streams: no text layer, nothing to draw. Offsets
 * are counted as the file is written, because a repaired xref would be pdfjs
 * recovering from this test rather than this test testing pdfjs.
 */
function blankPdf(pages = 1): Buffer {
  const kids = Array.from({ length: pages }, (_, index) => `${index + 3} 0 R`).join(" ");

  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    `<</Type/Pages/Kids[${kids}]/Count ${pages}>>`,
    ...Array.from({ length: pages }, () => "<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>"),
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const start = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${start}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
}

test("a page with a readable text layer is never sent to OCR", () => {
  assert.deepEqual(pagesNeedingOcr([PAGE, "", "Fig. 1"]), [2, 3]);
});

test("recognised text takes the page number of the page it was read from", () => {
  const { blocks, ocr } = mergePages(
    [PAGE, "", "page three body text, long enough to stand on its own"],
    new Map([[2, "  DUO   brochure, price list inside  "]]),
  );

  assert.deepEqual(blocks, [
    { text: PAGE, page: 1 },
    { text: "DUO brochure, price list inside", page: 2 },
    { text: "page three body text, long enough to stand on its own", page: 3 },
  ]);
  assert.equal(ocr, 1);
});

test("a page OCR could not read keeps the little its own layer said", () => {
  const { blocks, ocr } = mergePages(["", "Fig. 1"], new Map([[1, "  "]]));

  assert.deepEqual(blocks, [{ text: "Fig. 1", page: 2 }]);
  assert.equal(ocr, 0);
});

test("a scan-only PDF is drawn and read, page numbers intact", async () => {
  const asked: number[][] = [];

  const { blocks, meta } = await extractSource(
    { bytes: blankPdf(), mime: "application/pdf", name: "duo-brochure.pdf" },
    {
      ocr: async (_bytes, pages) => {
        asked.push(pages);
        return new Map(pages.map((page) => [page, "DUO brochure, price list inside."]));
      },
    },
  );

  assert.deepEqual(asked, [[1]]);
  assert.deepEqual(blocks, [{ text: "DUO brochure, price list inside.", page: 1 }]);
  assert.deepEqual(meta, { kind: "document", pages: 1, ocr: 1 });
});

test("a scan wider than the OCR ceiling is refused before a page is drawn", async () => {
  let drawn = false;

  await assert.rejects(
    () =>
      extractSource(
        { bytes: blankPdf(OCR_MAX_PAGES + 1), mime: "application/pdf", name: "long-scan.pdf" },
        {
          ocr: async () => {
            drawn = true;
            return new Map();
          },
        },
      ),
    (error: unknown) => error instanceof ExtractError && error.code === "SOURCE_TOO_LARGE",
  );

  assert.equal(drawn, false);
});
