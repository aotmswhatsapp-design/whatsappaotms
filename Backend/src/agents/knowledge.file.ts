import { createHash } from "node:crypto";

import { ExtractError } from "./extract.errors";

/** The same ceiling the inbox uses for what leaves, applied to what arrives. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** How much of the original filename a title keeps. */
const TITLE_MAX = 160;

/** Every format with a verified reader in `extract.ts`. Images, audio and
 *  video are named below only so a refusal can say what the file was. */
export const DOCUMENT_EXTENSIONS = ["pdf", "docx", "txt", "md", "csv", "xlsx"] as const;
export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"] as const;
export const AUDIO_EXTENSIONS = [
  "mp3",
  "m4a",
  "ogg",
  "oga",
  "wav",
  "flac",
  "opus",
  "webm",
] as const;

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  opus: "audio/ogg",
  webm: "audio/webm",
};

export type FileKind = "document" | "image" | "audio";

export interface InspectedFile {
  kind: FileKind;
  mime: string;
  extension: string;
  title: string;
  sha256: string;
}

export function extensionOf(name: string): string {
  const at = name.lastIndexOf(".");
  return at >= 0 ? name.slice(at + 1).toLowerCase() : "";
}

/**
 * The declared type when it says something, the extension when it does not.
 *
 * A browser that cannot name a type sends `application/octet-stream`, and an
 * upload without a type sends nothing at all; in both cases the file's own
 * extension is better evidence.
 */
export function resolveMime(declared: string | null, name: string): string {
  const base = (declared ?? "").toLowerCase().split(";")[0].trim();
  const byName = MIME[extensionOf(name)] ?? "";

  if (!base || base === "application/octet-stream") return byName || base;

  return base.includes("/") ? base : byName || base;
}

export function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * What an upload must prove before it costs a bucket object and a queue slot.
 *
 * The declared MIME is never trusted: a browser that cannot name a type says
 * `application/octet-stream`, and a client that wants to smuggle a `.zip` will
 * say `application/pdf`. The bytes decide, the extension says which of that
 * family's readers to use, and the two must agree.
 */
export function inspectUpload(input: {
  name: string;
  declaredMime: string;
  bytes: Buffer;
  limit?: number;
}): InspectedFile {
  const limit = input.limit ?? MAX_SOURCE_BYTES;
  const extension = extensionOf(input.name);
  const kind = kindOf(extension);

  if (!kind) {
    throw new ExtractError(
      "SOURCE_UNSUPPORTED",
      `A ${extension ? `.${extension}` : "file of that type"} cannot be read. Upload a PDF, DOCX, TXT, CSV or XLSX, or paste the text as a note.`,
    );
  }

  // Reading a picture or a recording is a model call, and this product runs
  // without one. The refusal names the way forward rather than the missing
  // feature, and it happens before a bucket object exists.
  if (kind !== "document") {
    throw new ExtractError(
      "SOURCE_UNSUPPORTED",
      kind === "image"
        ? "Images cannot be read without an AI model. Upload a PDF, DOCX, TXT, CSV or XLSX, or paste the text as a note."
        : "Voice notes cannot be read without an AI model. Upload a PDF, DOCX, TXT, CSV or XLSX, or paste the text as a note.",
    );
  }

  if (input.bytes.length === 0) {
    throw new ExtractError("SOURCE_EMPTY", "That file arrived empty.");
  }

  if (input.bytes.length > limit) {
    throw new ExtractError(
      "SOURCE_TOO_LARGE",
      `Training files are limited to ${Math.round(limit / (1024 * 1024))} MB.`,
    );
  }

  const sniffed = sniff(input.bytes);

  if (!agrees(extension, sniffed)) {
    throw new ExtractError(
      "SOURCE_UNSUPPORTED",
      "That file could not be read. It may be corrupt, password-protected, or not really the format its name says.",
    );
  }

  return {
    kind,
    mime: MIME[extension] ?? input.declaredMime,
    extension: extension === "jpeg" ? "jpg" : extension,
    title: titleOf(input.name, extension),
    // Hashing 25 MB is cheap and happens once, before the bytes are stored.
    sha256: sha256Of(input.bytes),
  };
}

/**
 * The filename as a label, capped without cutting the extension off: a title
 * that ends in `.pd` tells the reader nothing about the file.
 */
function titleOf(name: string, extension: string): string {
  const trimmed = name.trim();

  if (trimmed.length === 0) return "Untitled file";
  if (trimmed.length <= TITLE_MAX) return trimmed;

  const suffix = extension ? `.${extension}` : "";

  return `${trimmed.slice(0, TITLE_MAX - suffix.length)}${suffix}`;
}

function kindOf(extension: string): FileKind | null {
  if ((DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) return "document";
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(extension)) return "image";
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(extension)) return "audio";
  return null;
}

type Sniffed =
  | "pdf"
  | "zip"
  | "jpeg"
  | "png"
  | "webp"
  | "gif"
  | "mp3"
  | "m4a"
  | "ogg"
  | "wav"
  | "flac"
  | "webm"
  | "text"
  | "binary";

function sniff(bytes: Buffer): Sniffed {
  if (bytes.length >= 5 && bytes.toString("latin1", 0, 5) === "%PDF-") return "pdf";
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    return "zip";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (bytes.length >= 12 && bytes.toString("latin1", 8, 12) === "WAVE") return "wav";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString("latin1", 0, 6))) return "gif";
  if (bytes.length >= 4 && bytes.toString("latin1", 0, 4) === "fLaC") return "flac";
  if (bytes.length >= 4 && bytes.toString("latin1", 0, 4) === "OggS") return "ogg";
  if (bytes.length >= 3 && bytes.toString("latin1", 0, 3) === "ID3") return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  if (bytes.length >= 12 && bytes.toString("latin1", 4, 8) === "ftyp") return "m4a";
  // EBML header: WebM audio (Chrome's MediaRecorder voice note) shares it with
  // Matroska video. No video is allowed in, so the container decides nothing
  // more than "this is the audio the recorder produced".
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "webm";
  }

  // Text has no magic. A NUL byte in the first 8 KiB, or a decode that is
  // mostly replacement characters, is the cheapest reliable tell.
  const head = bytes.subarray(0, 8192);
  if (!head.includes(0)) {
    const decoded = head.toString("utf8");
    const bad = (decoded.match(/\uFFFD/g) ?? []).length;
    if (bad <= decoded.length * 0.02) return "text";
  }

  return "binary";
}

function agrees(extension: string, sniffed: Sniffed): boolean {
  const family = kindOf(extension);

  if (family === "document") {
    if (extension === "pdf") return sniffed === "pdf";
    if (extension === "docx" || extension === "xlsx") return sniffed === "zip";
    return sniffed === "text"; // txt, md, csv
  }

  if (family === "image") {
    if (extension === "jpg" || extension === "jpeg") return sniffed === "jpeg";
    if (extension === "png") return sniffed === "png";
    if (extension === "webp") return sniffed === "webp";
    return sniffed === "gif";
  }

  if (family === "audio") {
    if (extension === "mp3") return sniffed === "mp3";
    if (extension === "m4a") return sniffed === "m4a";
    if (extension === "wav") return sniffed === "wav";
    if (extension === "flac") return sniffed === "flac";
    if (extension === "webm") return sniffed === "webm";
    return sniffed === "ogg"; // ogg, oga, opus
  }

  return false;
}
