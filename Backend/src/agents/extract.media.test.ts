import assert from "node:assert/strict";
import { test } from "node:test";

import { OpenAiMediaExtractor } from "./extract.media";

test("an image read carries the vision call's own token usage", async () => {
  const calls: any[] = [];
  const extractor = new OpenAiMediaExtractor({
    describeImage: async (input: any) => {
      calls.push(input);
      return { text: "A price list.", tokensIn: 900, tokensOut: 40 };
    },
  } as any);

  const read = await extractor.read({
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    mime: "image/png",
    name: "menu.png",
    model: "gpt-4o-mini",
  });

  assert.deepEqual(read, { text: "A price list.", tokens: 940 });
  assert.equal(calls[0].model, "gpt-4o-mini");
});

test("a voice note reports zero because Whisper returns no usage", async () => {
  const extractor = new OpenAiMediaExtractor({
    transcribe: async () => ({ text: "How much is delivery?" }),
  } as any);

  const read = await extractor.read({
    bytes: Buffer.from([0x49, 0x44, 0x33]),
    mime: "audio/mpeg",
    name: "note.mp3",
    model: "gpt-4o-mini",
  });

  assert.deepEqual(read, { text: "How much is delivery?", tokens: 0 });
});
