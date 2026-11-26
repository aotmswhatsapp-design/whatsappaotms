import assert from "node:assert/strict";
import { test } from "node:test";

import { probeImage } from "./image.probe";

// 1×1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** GIF89a, little-endian width and height. */
const gif = (width: number, height: number) => {
  const head = Buffer.alloc(13);
  head.write("GIF89a", 0, "latin1");
  head.writeUInt16LE(width, 6);
  head.writeUInt16LE(height, 8);
  return head;
};

test("a PNG reports its own type and size", () => {
  assert.deepEqual(probeImage(PNG), { mime: "image/png", width: 1, height: 1 });
});

test("a GIF reports its size", () => {
  assert.deepEqual(probeImage(gif(2, 3)), { mime: "image/gif", width: 2, height: 3 });
});

test("a JPEG that cannot be walked is still a JPEG", () => {
  const got = probeImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]));
  assert.deepEqual(got, { mime: "image/jpeg", width: null, height: null });
});

test("a PDF is not an image", () => {
  assert.equal(probeImage(Buffer.from("%PDF-1.7")), null);
});
