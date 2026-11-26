import assert from "node:assert/strict";
import { test } from "node:test";

import { contextBlock } from "./reply.prompt";
import type { ContextChunk } from "./retrieval.service";

const chunk = (over: Partial<ContextChunk>): ContextChunk => ({
  id: "c", text: "body", sourceId: "s", title: "Price list", score: 0.9,
  page: null, sheet: null, rowFrom: null, rowTo: null, heading: null, ...over,
});

test("a page is named in the citation label", () => {
  assert.ok(contextBlock([chunk({ page: 4 })]).includes("[Price list · page 4]"));
});

test("a sheet and its row range are named", () => {
  const label = contextBlock([chunk({ sheet: "Wholesale", rowFrom: 12, rowTo: 24 })]);
  assert.ok(label.includes('[Price list · sheet "Wholesale" rows 12–24]'));
});

test("a plain chunk keeps the bare title", () => {
  assert.ok(contextBlock([chunk({})]).includes("[Price list]"));
});
