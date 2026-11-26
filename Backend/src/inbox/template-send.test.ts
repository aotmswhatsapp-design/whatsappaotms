import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildMessage,
  headerMediaProblem,
  problemsIn,
  shapeOf,
} from "./template-send";

const imageHeader = [
  { type: "HEADER", format: "IMAGE", example: { header_handle: ["4::abc"] } },
  { type: "BODY", text: "Order {{1}} is on its way." },
];

const textHeader = [
  { type: "HEADER", format: "TEXT", text: "Hello {{1}}" },
  { type: "BODY", text: "Order {{2}} is on its way." },
];

test("an image header sends its image, not nothing", () => {
  // The failure this guards: an IMAGE header has no `text`, so a send that
  // only reads text emits no header at all and Meta answers
  // "Format Mismatch, expected Image, received UNKNOWN".
  const shape = shapeOf(imageHeader);

  assert.equal(shape.headerFormat, "IMAGE");
  assert.equal(shape.header, null);

  const built = buildMessage({
    shape,
    format: "POSITIONAL",
    values: { "1": "A-12" },
    buttonUrls: {},
    headerImage: "https://storage.example/sample.jpg?sig=1",
    tapTarget: null,
  });

  assert.deepEqual(built.components[0], {
    type: "header",
    parameters: [
      {
        type: "image",
        image: { link: "https://storage.example/sample.jpg?sig=1" },
      },
    ],
  });
  assert.deepEqual(built.components[1], {
    type: "body",
    parameters: [{ type: "text", text: "A-12" }],
  });
});

test("a text header keeps filling tokens as before", () => {
  const shape = shapeOf(textHeader);

  assert.equal(shape.headerFormat, "TEXT");
  assert.deepEqual(shape.tokens, ["1", "2"]);

  const built = buildMessage({
    shape,
    format: "POSITIONAL",
    values: { "1": "Ada", "2": "A-12" },
    buttonUrls: {},
    tapTarget: null,
  });

  assert.deepEqual(built.components[0], {
    type: "header",
    parameters: [{ type: "text", text: "Ada" }],
  });
});

test("an image header without a stored sample is named, not silently dropped", () => {
  const shape = shapeOf(imageHeader);

  assert.match(headerMediaProblem(shape, null) ?? "", /no image is stored/i);

  const built = buildMessage({
    shape,
    format: "POSITIONAL",
    values: { "1": "A-12" },
    buttonUrls: {},
    headerImage: null,
    tapTarget: null,
  });

  assert.equal(
    built.components.some(
      (component) => (component as { type?: string }).type === "header",
    ),
    false,
    "an empty link must not be sent as an image parameter",
  );
});

test("a template with no media header has no media problem", () => {
  assert.equal(headerMediaProblem(shapeOf(textHeader), null), null);
  assert.equal(headerMediaProblem(shapeOf([]), null), null);
});

test("a video or document header says it cannot be sent yet", () => {
  const shape = shapeOf([
    { type: "HEADER", format: "VIDEO", example: { header_handle: ["4::v"] } },
    { type: "BODY", text: "Watch this." },
  ]);

  assert.match(headerMediaProblem(shape, "https://example/x.mp4") ?? "", /video/i);
});

test("draft validation still only speaks about variables", () => {
  // Campaigns validate a draft before any send exists, so an image header must
  // not be reported missing there — the sample is minted at send time.
  const problems = problemsIn({
    shape: shapeOf(imageHeader),
    format: "POSITIONAL",
    values: { "1": "A-12" },
    buttonUrls: {},
    tapTarget: null,
  });

  assert.deepEqual(problems, []);
});
