import assert from "node:assert/strict";
import { test } from "node:test";

import sharp from "sharp";

import {
  cardFilePath,
  cardFolderFor,
  cardImagePath,
  ownedCardPath,
  prepareCardFile,
  prepareCardImage,
  storedFile,
} from "./bot.media";
import { MAX_CARD_FILE_BYTES, MAX_CARD_VIDEO_BYTES } from "./bot.limits";

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

test("only a plain file name in this agent's folder is an upload to delete", () => {
  const owned = (path: string) =>
    ownedCardPath({ workspaceId: "ws-1", agentId: "agent-1", path });

  assert.equal(owned("bots/ws-1/agent-1/abc.jpg"), "bots/ws-1/agent-1/abc.jpg");

  // A document and a video are the same folder, so the same guard.
  assert.equal(
    owned("bots/ws-1/agent-1/abc__menu.pdf"),
    "bots/ws-1/agent-1/abc__menu.pdf",
  );
  assert.equal(
    owned("bots/ws-1/agent-1/abc__tour.mp4"),
    "bots/ws-1/agent-1/abc__tour.mp4",
  );

  // Another workspace's folder, and a sibling agent's, are unknown here.
  assert.equal(owned("bots/ws-2/agent-1/abc.jpg"), null);
  assert.equal(owned("bots/ws-1/agent-2/abc.jpg"), null);

  // A prefix match is not enough: `..` must not climb out of the folder.
  assert.equal(owned("bots/ws-1/agent-1/../agent-2/abc.jpg"), null);
  assert.equal(owned("bots/ws-1/agent-1/.."), null);

  // Nested names and file types we never store are refused too.
  assert.equal(owned("bots/ws-1/agent-1/nested/abc.jpg"), null);
  assert.equal(owned("bots/ws-1/agent-1/secret.env"), null);
  assert.equal(owned("bots/ws-1/agent-1/../../etc/passwd"), null);
  assert.equal(owned(""), null);
});

test("a document is stored exactly as it was uploaded", () => {
  const bytes = Buffer.from("%PDF-1.7\n% a price list\n");
  const outcome = prepareCardFile({
    bytes,
    mime: "application/pdf",
    name: "Price list.pdf",
  });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  assert.equal(outcome.file.bytes, bytes, "no decoder rewrites a PDF");
  assert.equal(outcome.file.mime, "application/pdf");
  assert.equal(outcome.file.kind, "document");
  assert.equal(outcome.file.name, "Price list.pdf");
});

test("a video is held to Meta's own ceiling, a document to ours", () => {
  const tooBigForVideo = prepareCardFile({
    bytes: Buffer.alloc(MAX_CARD_VIDEO_BYTES + 1),
    mime: "video/mp4",
    name: "tour.mp4",
  });

  assert.equal(tooBigForVideo.ok, false);
  if (tooBigForVideo.ok) return;
  assert.match(tooBigForVideo.reason, /Videos are limited to 16 MB/);

  // The same bytes pass as a document: the two ceilings are not the same one.
  const asDocument = prepareCardFile({
    bytes: Buffer.alloc(MAX_CARD_VIDEO_BYTES + 1),
    mime: "application/pdf",
    name: "report.pdf",
  });

  assert.equal(asDocument.ok, true);

  const tooBigForEither = prepareCardFile({
    bytes: Buffer.alloc(MAX_CARD_FILE_BYTES + 1),
    mime: "application/pdf",
    name: "big.pdf",
  });

  assert.equal(tooBigForEither.ok, false);
  if (tooBigForEither.ok) return;
  assert.match(tooBigForEither.reason, /Files are limited to 20 MB/);
});

test("a type we do not send is refused with what we do send", () => {
  const outcome = prepareCardFile({
    bytes: Buffer.from("MZ\u0090\u0000"),
    mime: "application/x-msdownload",
    name: "installer.exe",
  });

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.reason, /PDF, Word, Excel/);
});

test("a file with no declared type is named by its extension", () => {
  const outcome = prepareCardFile({
    bytes: Buffer.from("dish,price\ndosa,80\n"),
    mime: "application/octet-stream",
    name: "menu.csv",
  });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  assert.equal(outcome.file.kind, "document");
  assert.equal(outcome.file.mime, "text/csv");
});

test("the stored name is the upload's own, shortened and made safe", () => {
  const outcome = prepareCardFile({
    bytes: Buffer.from("%PDF-1.7"),
    mime: "application/pdf",
    // A folder part, characters a file name cannot carry, and a doubled space.
    name: "C:\\Users\\me\\Form:  " + "x".repeat(120) + ".PDF",
  });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  assert.match(outcome.file.name, /^Form x+/);
  assert.match(outcome.file.name, /\.pdf$/u, "the extension is the type's, lowercased");
  assert.ok(outcome.file.name.length <= 84, `got ${outcome.file.name.length}`);
  assert.ok(!/[\\/:]/u.test(outcome.file.name));
});

test("a stored key gives back the name it was written with", () => {
  const path = cardFilePath({
    workspaceId: "ws-1",
    agentId: "agent-1",
    name: "Price list.pdf",
    stem: "abc",
  });

  assert.equal(path, "bots/ws-1/agent-1/abc__Price list.pdf");
  assert.deepEqual(storedFile(path), { name: "Price list.pdf", kind: "document" });
  assert.deepEqual(
    storedFile("bots/ws-1/agent-1/abc__tour.mp4"),
    { name: "tour.mp4", kind: "video" },
  );

  // A picture is not a file, and neither is anything we do not store.
  assert.equal(storedFile("bots/ws-1/agent-1/abc.jpg"), null);
  assert.equal(storedFile("bots/ws-1/agent-1/abc__notes.env"), null);
});
