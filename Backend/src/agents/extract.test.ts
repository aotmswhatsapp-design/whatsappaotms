import assert from "node:assert/strict";
import { test } from "node:test";
import * as ExcelJS from "exceljs";

import { ExtractError } from "./ai.errors";
import { csvBlocks, docxHtmlToBlocks, extractSource, pagesToBlocks, parseCsv } from "./extract";

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

test("every CSV block repeats the headers and reports its own row range", () => {
  const rows = [["item", "price"]];
  for (let index = 1; index <= 45; index += 1) rows.push([`item ${index}`, String(index * 10)]);

  const { blocks, meta } = csvBlocks(rows);

  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((block) => [block.rowFrom, block.rowTo]), [[1, 20], [21, 40], [41, 45]]);
  assert.ok(blocks.every((block) => block.text.startsWith("Columns: item | price")));
  assert.ok(blocks[0].text.includes("item 1 | 10"));
  assert.deepEqual(meta, { kind: "table", sheets: [{ name: "CSV", headers: ["item", "price"], rowCount: 45 }] });
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
