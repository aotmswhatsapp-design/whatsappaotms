import assert from "node:assert/strict";
import { test } from "node:test";

import { CSV_MIME, CSV_SHEET } from "./extract";
import { contextBlock } from "./reply.prompt";
import type { ContextChunk } from "./retrieval.service";

/** What a `.xlsx` upload records (see `knowledge.file.ts`), whatever its sheets
 *  are called. */
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const chunk = (over: Partial<ContextChunk>): ContextChunk => ({
  id: "c", text: "body", sourceId: "s", title: "Price list", mime: null, score: 0.9,
  page: null, sheet: null, rowFrom: null, rowTo: null, heading: null, ...over,
});

test("a page is named in the citation label", () => {
  assert.ok(contextBlock([chunk({ page: 4 })]).includes("[Price list · page 4]"));
});

test("a sheet and its row range are named", () => {
  const label = contextBlock([chunk({ sheet: "Wholesale", rowFrom: 12, rowTo: 24 })]);
  assert.ok(label.includes('[Price list · sheet "Wholesale" rows 12–24]'));
});

test("a CSV names records, because a quoted line break makes records and lines differ", () => {
  const label = contextBlock([chunk({ mime: CSV_MIME, sheet: CSV_SHEET, rowFrom: 2, rowTo: 21 })]);
  assert.ok(label.includes("[Price list · CSV records 2–21]"));
});

test("a workbook worksheet called CSV is a sheet, not a CSV file", () => {
  const label = contextBlock([chunk({ mime: XLSX_MIME, sheet: CSV_SHEET, rowFrom: 7, rowTo: 26 })]);
  assert.ok(label.includes('[Price list · sheet "CSV" rows 7–26]'));
});

test("an unknown MIME falls back to the sheet, never to the CSV wording", () => {
  const label = contextBlock([chunk({ mime: null, sheet: CSV_SHEET, rowFrom: 2, rowTo: 21 })]);
  assert.ok(label.includes('[Price list · sheet "CSV" rows 2–21]'));
});

test("a plain chunk keeps the bare title", () => {
  assert.ok(contextBlock([chunk({})]).includes("[Price list]"));
});
