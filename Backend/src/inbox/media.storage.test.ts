import assert from "node:assert/strict";
import { test } from "node:test";

import { ServiceUnavailableException } from "@nestjs/common";

import { MediaStorage } from "./media.storage";

const CONFIG = {
  get: (key: string) =>
    key === "SUPABASE_URL"
      ? "https://storage.test"
      : key === "SUPABASE_SERVICE_ROLE_KEY"
        ? "test-key"
        : undefined,
};

const storage = () => new MediaStorage(CONFIG as never, "agent-sources");

/** The timeout `AbortSignal.timeout` produces, without waiting 30 s for it. */
const timedOut = () =>
  Object.assign(new Error("The operation was aborted due to timeout"), {
    name: "TimeoutError",
  });

const withFetch = async (
  impl: () => Promise<unknown>,
  run: () => Promise<void>,
): Promise<void> => {
  const original = globalThis.fetch;
  globalThis.fetch = impl as unknown as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
};

const isUnavailable = (error: unknown) =>
  error instanceof ServiceUnavailableException &&
  error.getStatus() === 503 &&
  (error.getResponse() as { code?: string }).code === "STORAGE_UNAVAILABLE";

test("a storage request that never answers is a 503, not a 500", async () => {
  const media = storage();

  await withFetch(
    async () => {
      throw timedOut();
    },
    async () => {
      await assert.rejects(
        () => media.upload("a/b.pdf", Buffer.from("x"), "application/pdf"),
        isUnavailable,
      );
      await assert.rejects(
        () => media.signedUrl("a/b.pdf"),
        isUnavailable,
      );
    },
  );
});

test("a strict delete rethrows a timeout", async () => {
  const media = storage();

  await withFetch(
    async () => {
      throw timedOut();
    },
    async () => {
      await assert.rejects(
        () => media.remove(["a/b.pdf"], { strict: true }),
        isUnavailable,
      );
    },
  );
});

test("a strict delete rethrows a non-OK answer", async () => {
  const media = storage();

  await withFetch(
    async () => ({ ok: false, status: 500 }),
    async () => {
      await assert.rejects(
        () => media.remove(["a/b.pdf"], { strict: true }),
        isUnavailable,
      );
    },
  );
});

test("a best-effort delete logs a timeout and returns", async () => {
  const media = storage();

  await withFetch(
    async () => {
      throw timedOut();
    },
    async () => {
      await media.remove(["a/b.pdf"]);
    },
  );

  assert.equal(media.configured, true);
});
