import sharp from "sharp";

import { inspectImage } from "../templates/template-media";
import type { CardFileKind } from "./bot.card";
import { MAX_CARD_FILE_BYTES, MAX_CARD_VIDEO_BYTES } from "./bot.limits";

/**
 * A card picture, prepared once on the way in.
 *
 * Optimising server-side rather than in the browser is deliberate: the phone
 * that uploads may be the worst device in the workspace, the stored file is
 * what every customer downloads, and a re-encoded JPEG is also what strips the
 * EXIF GPS tag a customer photo carries.
 *
 * The long edge matches a phone screen, so a 12 MP upload becomes roughly
 * 1080 × 1080 at most — a card bubble on WhatsApp is a few hundred pixels.
 */

/** Longest edge kept; everything larger is scaled down, never up. */
const MAX_EDGE = 1080;

/** Visually lossless for photographs and small enough to send over a slow link. */
const QUALITY = 82;

export interface PreparedCardImage {
  bytes: Buffer;
  mime: "image/jpeg";
  width: number | null;
  height: number | null;
}

export type PrepareOutcome =
  | { ok: true; image: PreparedCardImage }
  | { ok: false; reason: string };

/**
 * Validates the bytes, then re-encodes them as a JPEG.
 *
 * The checks are the templates' own (`inspectImage`): JPEG, PNG and static
 * WebP only, at most 5 MB. They run before decoding so a renamed file is
 * refused with the reason the customer can act on, rather than a generic
 * decoder failure.
 */
export async function prepareCardImage(bytes: Buffer): Promise<PrepareOutcome> {
  const inspection = inspectImage(bytes);

  if (!inspection.ok) return inspection;

  try {
    const { data, info } = await sharp(bytes, { failOn: "none" })
      // `rotate()` with no argument applies the EXIF orientation, so a photo
      // taken sideways is stored the way the sender sees it.
      .rotate()
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      // A transparent PNG would otherwise turn black where a JPEG has no
      // alpha; white is what WhatsApp's own bubbles use behind a picture.
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: QUALITY, mozjpeg: true, progressive: true })
      .toBuffer({ resolveWithObject: true });

    return {
      ok: true,
      image: {
        bytes: data,
        mime: "image/jpeg",
        width: info.width,
        height: info.height,
      },
    };
  } catch {
    return {
      ok: false,
      reason: "That image could not be read. Try a JPEG, PNG or WebP file.",
    };
  }
}

/**
 * The file types a card may hand over, by the type the browser declared.
 *
 * A list rather than a prefix test on purpose: `application/*` would let an
 * installer or a disk image through, and Meta refuses those — so a business
 * would only find out when the card failed to send. `.doc` and `.docx` are
 * both here because a desktop Office install still writes the older one.
 */
const DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
};

const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
};

/**
 * The kind a stored file is, by its extension.
 *
 * The listing has no other way to know: storage keeps the bytes and the key,
 * and the key carries the extension the upload was given.
 */
const KIND_BY_EXTENSION: Record<string, CardFileKind> = {
  pdf: "document",
  doc: "document",
  docx: "document",
  xls: "document",
  xlsx: "document",
  ppt: "document",
  pptx: "document",
  txt: "document",
  csv: "document",
  mp4: "video",
  "3gp": "video",
};

/** What one accepted file becomes on its way in. */
export interface PreparedCardFile {
  bytes: Buffer;
  mime: string;
  /** The extension the stored key ends with, decided by the type, not the name. */
  extension: string;
  /** What the customer's phone calls the download. */
  name: string;
  kind: CardFileKind;
}

export type PrepareFileOutcome =
  | { ok: true; file: PreparedCardFile }
  | { ok: false; reason: string };

/**
 * Validates a document or a video, and keeps the bytes exactly as uploaded.
 *
 * Re-encoding is for pictures: a JPEG can be re-made without loss, a PDF or a
 * `.docx` cannot — they are containers, and a decoder that rewrote one would
 * produce a file the customer cannot open. So unlike `prepareCardImage` this
 * only checks and names.
 *
 * The declared type decides the kind, because the bytes of a zip container are
 * not worth sniffing here; when the browser sends nothing useful, the original
 * name's extension is the fallback. Both must agree with the allowlist, so a
 * renamed `.exe` is refused either way.
 */
export function prepareCardFile(input: {
  bytes: Buffer;
  mime: string;
  name: string;
}): PrepareFileOutcome {
  if (input.bytes.length === 0) {
    return { ok: false, reason: "The file arrived empty." };
  }

  const typed = kindOfMime(input.mime) ?? kindOfName(input.name);

  if (!typed) {
    return {
      ok: false,
      reason:
        "That file type is not one a card can send. Use a PDF, Word, Excel, PowerPoint, text or CSV file, or an MP4 or 3GP video.",
    };
  }

  const cap =
    typed.kind === "video" ? MAX_CARD_VIDEO_BYTES : MAX_CARD_FILE_BYTES;
  const megabytes = Math.round(cap / (1024 * 1024));

  if (input.bytes.length > cap) {
    return {
      ok: false,
      reason: `${typed.kind === "video" ? "Videos" : "Files"} are limited to ${megabytes} MB.`,
    };
  }

  return {
    ok: true,
    file: {
      bytes: input.bytes,
      mime: mimeOf(typed.extension),
      extension: typed.extension,
      name: cleanName(input.name, typed.extension),
      kind: typed.kind,
    },
  };
}

/** The file type a declared MIME names, when it is one we send. */
function kindOfMime(mime: string): { kind: CardFileKind; extension: string } | null {
  const clean = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  const document = DOCUMENT_TYPES[clean];

  if (document) return { kind: "document", extension: document };

  const video = VIDEO_TYPES[clean];

  return video ? { kind: "video", extension: video } : null;
}

/** The same answer from the original name, for a browser that declared nothing. */
function kindOfName(name: string): { kind: CardFileKind; extension: string } | null {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const kind = KIND_BY_EXTENSION[extension];

  return kind ? { kind, extension } : null;
}

/** The type to store the bytes under, so a download opens in the right app. */
function mimeOf(extension: string): string {
  const document = Object.entries(DOCUMENT_TYPES).find(
    ([, stored]) => stored === extension,
  );

  if (document) return document[0];

  const video = Object.entries(VIDEO_TYPES).find(
    ([, stored]) => stored === extension,
  );

  return video ? video[0] : "application/octet-stream";
}

/**
 * The original name, made safe to keep and short enough to read on a phone.
 *
 * WhatsApp shows this name on the download, so it is worth preserving rather
 * than numbering: the folder part goes, characters a file name cannot carry
 * are dropped, and anything past 80 characters is trimmed. The extension is
 * taken from the type, so a file named `.PDF` or with none at all still opens.
 */
function cleanName(raw: string, extension: string): string {
  const base = raw.split(/[\\/]/u).pop() ?? "";
  const stem = base
    .replace(/\.[^.]+$/u, "")
    .replace(/\s+/gu, " ")
    .replace(/[<>:"|?*\u0000-\u001f]/gu, "")
    .trim()
    .slice(0, 80)
    .trim();

  return `${stem || "file"}.${extension}`;
}

/** The folder one agent's card pictures live in. */
export function cardFolderFor(workspaceId: string, agentId: string): string {
  return ["bots", workspaceId, agentId].join("/");
}

/**
 * A stored name inside that folder.
 *
 * Timestamp first so a plain listing reads oldest to newest, and the random
 * suffix so two uploads in the same millisecond cannot collide.
 */
export function cardImagePath(input: {
  workspaceId: string;
  agentId: string;
  /** Overridable so a test can assert the path instead of a pattern. */
  stem?: string;
}): string {
  const stem =
    input.stem ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  return `${cardFolderFor(input.workspaceId, input.agentId)}/${stem}.jpg`;
}

/**
 * A stored name for one card file.
 *
 * Timestamp first so a plain listing reads oldest to newest, then the original
 * name so the gallery can say what a stored file actually is. The two are
 * joined by `__`, which the random stem cannot contain and the cleaned name
 * cannot introduce at its start — so `storedFile` can split on the first one
 * and get back exactly the name the upload was given.
 */
export function cardFilePath(input: {
  workspaceId: string;
  agentId: string;
  /** The cleaned name, extension included: it ends the key. */
  name: string;
  /** Overridable so a test can assert the path instead of a pattern. */
  stem?: string;
}): string {
  const stem =
    input.stem ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  return `${cardFolderFor(input.workspaceId, input.agentId)}/${stem}__${input.name}`;
}

/**
 * What a stored file is, read back from its key.
 *
 * The same shape the flow stores, so the gallery can offer an old upload
 * without keeping a second table: the name is the key's own tail and the kind
 * is its extension. Anything unknown is not a card file at all.
 */
export function storedFile(path: string): { name: string; kind: CardFileKind } | null {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const at = base.indexOf("__");
  const name = at >= 0 ? base.slice(at + 2) : base;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const kind = KIND_BY_EXTENSION[extension];

  return kind ? { name, kind } : null;
}

/**
 * The stored picture or file a path names, or `null` when it is not this
 * agent's.
 *
 * Deleting is permanent, and the path arrives from the client, so it is checked
 * against the folder this agent owns before any request reaches storage. The
 * check is exact rather than permissive: one plain file name directly inside
 * the folder, ending in an extension we actually store. A `..` segment would
 * climb out of a prefix match, so nested names are refused too — the uploader
 * never writes one.
 */
export function ownedCardPath(input: {
  workspaceId: string;
  agentId: string;
  path: string;
}): string | null {
  const folder = `${cardFolderFor(input.workspaceId, input.agentId)}/`;

  if (!input.path.startsWith(folder)) return null;

  const name = input.path.slice(folder.length);

  if (!name || name.includes("/") || name.includes("\\")) return null;

  const extension = name.split(".").pop()?.toLowerCase() ?? "";

  if (!KIND_BY_EXTENSION[extension] && !/^jpe?g$/u.test(extension)) return null;

  return input.path;
}
