import assert from "node:assert/strict";
import { test } from "node:test";

import { ExtractError } from "./ai.errors";
import { inspectUpload, sha256Of } from "./knowledge.file";

const LIMIT = 25 * 1024 * 1024;
const pdf = (body = "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF") =>
  Buffer.from(body);
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const gif = Buffer.from("GIF89a        ", "latin1");
const webm = Buffer.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81,
]);

const inspect = (name: string, declaredMime: string, bytes: Buffer) =>
  inspectUpload({ name, declaredMime, bytes, limit: LIMIT });

test("a PDF is accepted as a document, whatever the browser called it", () => {
  const got = inspect("prices.pdf", "application/octet-stream", pdf());
  assert.equal(got.kind, "document");
  assert.equal(got.mime, "application/pdf");
  assert.equal(got.extension, "pdf");
});

test("the declared MIME is replaced by the sniffed one", () => {
  const got = inspect("menu.png", "image/jpeg", png);
  assert.equal(got.mime, "image/png");
  assert.equal(got.extension, "png");
});

test("docx and xlsx are both zips and are told apart by extension", () => {
  assert.equal(inspect("policy.docx", "", zip).kind, "document");
  assert.equal(inspect("rates.xlsx", "", zip).kind, "document");
});

test("a renamed archive is refused before anything is stored", () => {
  assert.throws(
    () => inspect("prices.pdf", "application/pdf", zip),
    /could not be read|not one/,
  );
});

test("a binary renamed .txt is refused", () => {
  const bytes = Buffer.concat([Buffer.from("hello"), Buffer.from([0])]);
  assert.throws(() => inspect("notes.txt", "text/plain", bytes), ExtractError);
});

test("gif is an image, not a document", () => {
  const got = inspect("menu.gif", "image/gif", gif);
  assert.equal(got.kind, "image");
  assert.equal(got.mime, "image/gif");
});

test("an unknown extension is refused with a sentence naming a real format", () => {
  assert.throws(() => inspect("archive.zip", "application/zip", zip), /Upload a PDF/);
});

test("a real .webm voice note is accepted as audio", () => {
  const got = inspect("note.webm", "audio/webm", webm);
  assert.equal(got.kind, "audio");
  assert.equal(got.mime, "audio/webm");
});

test("an oversized buffer is refused before it is hashed", () => {
  assert.throws(
    () =>
      inspectUpload({
        name: "big.pdf",
        declaredMime: "application/pdf",
        bytes: Buffer.alloc(LIMIT + 1),
        limit: LIMIT,
      }),
    /25 MB/,
  );
});

test("the hash is stable lowercase hex", () => {
  assert.equal(
    sha256Of(Buffer.from("a")),
    "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
  );
});

test("a title is trimmed and capped without touching the extension", () => {
  const got = inspect(`${"x".repeat(300)}.pdf`, "", pdf());
  assert.equal(got.title.length, 160);
  assert.ok(got.title.endsWith(".pdf"));
});
