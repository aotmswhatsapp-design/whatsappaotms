import assert from "node:assert/strict";
import { test } from "node:test";

import { type ArgumentsHost, PayloadTooLargeException } from "@nestjs/common";

import { SourceTooLargeFilter } from "./source-too-large.filter";

/** The two members of an Express response the shared filter touches. */
const host = () => {
  const seen: { status?: number; body?: Record<string, unknown> } = {};

  const response = {
    status(code: number) {
      seen.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      seen.body = body;
      return this;
    },
  };

  const argumentsHost = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: "POST", url: "/api/v1/agents/a/sources/file" }),
    }),
  } as unknown as ArgumentsHost;

  return { seen, argumentsHost };
};

test("Multer's bare 413 becomes SOURCE_TOO_LARGE", () => {
  const { seen, argumentsHost } = host();

  new SourceTooLargeFilter().catch(
    new PayloadTooLargeException("File too large"),
    argumentsHost,
  );

  assert.equal(seen.status, 413);
  assert.equal(seen.body?.statusCode, 413);
  assert.equal(seen.body?.code, "SOURCE_TOO_LARGE");
  assert.match(String(seen.body?.message), /limited to 25 MB\./);
});

test("the service's own 413 keeps the limit it names", () => {
  const { seen, argumentsHost } = host();

  new SourceTooLargeFilter().catch(
    new PayloadTooLargeException({
      code: "SOURCE_TOO_LARGE",
      message: "Training files are limited to 10 MB.",
    }),
    argumentsHost,
  );

  assert.equal(seen.status, 413);
  assert.equal(seen.body?.code, "SOURCE_TOO_LARGE");
  assert.equal(seen.body?.message, "Training files are limited to 10 MB.");
});
