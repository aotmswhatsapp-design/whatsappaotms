import assert from "node:assert/strict";
import { test } from "node:test";

import sharp from "sharp";

import {
  cardFolderFor,
  cardImagePath,
  ownedCardImagePath,
  prepareCardImage,
} from "./bot.media";

/** A real PNG, made by the same encoder the optimiser uses to decode it. */
const png = (width: number, height: number): Promise<Buffer> =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 120, b: 60 },
    },
  })
    .png()
    .toBuffer();

test("a big picture is stored small, as a JPEG", async () => {
  const outcome = await prepareCardImage(await png(2400, 1200));

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  assert.equal(outcome.image.mime, "image/jpeg");
  // JPEG magic: the bytes really were re-encoded, not passed through.
  assert.deepEqual([...outcome.image.bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.equal(Math.max(outcome.image.width ?? 0, outcome.image.height ?? 0), 1080);
  assert.ok(outcome.image.bytes.length < 2400 * 1200, "smaller than the pixels it came from");
});

test("a small picture is never enlarged", async () => {
  const outcome = await prepareCardImage(await png(320, 200));

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  assert.equal(outcome.image.width, 320);
  assert.equal(outcome.image.height, 200);
});

test("a renamed file is refused by its bytes, not its name", async () => {
  const outcome = await prepareCardImage(Buffer.from("this is not a picture"));

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;

  assert.match(outcome.reason, /JPEG, PNG and static WebP/);
});

test("an empty upload is refused before any decoder sees it", async () => {
  const outcome = await prepareCardImage(Buffer.alloc(0));

  assert.equal(outcome.ok, false);
});

test("a picture path is scoped to one workspace and one agent", () => {
  assert.equal(
    cardImagePath({ workspaceId: "ws-1", agentId: "agent-1", stem: "abc" }),
    "bots/ws-1/agent-1/abc.jpg",
  );

  assert.equal(cardFolderFor("ws-1", "agent-1"), "bots/ws-1/agent-1");
});

test("only a plain file name in this agent's folder is a picture to delete", () => {
  const owned = (path: string) =>
    ownedCardImagePath({ workspaceId: "ws-1", agentId: "agent-1", path });

  assert.equal(owned("bots/ws-1/agent-1/abc.jpg"), "bots/ws-1/agent-1/abc.jpg");

  // Another workspace's folder, and a sibling agent's, are unknown here.
  assert.equal(owned("bots/ws-2/agent-1/abc.jpg"), null);
  assert.equal(owned("bots/ws-1/agent-2/abc.jpg"), null);

  // A prefix match is not enough: `..` must not climb out of the folder.
  assert.equal(owned("bots/ws-1/agent-1/../agent-2/abc.jpg"), null);
  assert.equal(owned("bots/ws-1/agent-1/.."), null);

  // Nested names and other file types are never written by the uploader.
  assert.equal(owned("bots/ws-1/agent-1/nested/abc.jpg"), null);
  assert.equal(owned("bots/ws-1/agent-1/secret.env"), null);
  assert.equal(owned(""), null);
});
