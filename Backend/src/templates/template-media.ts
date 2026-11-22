/**
 * What Meta accepts as a template header image, and what a stored sample is
 * called.
 *
 * The checks live here rather than in the service because they are the only
 * part of this feature that can be proven without Meta, Supabase or a request:
 * they read bytes, and a renamed `.jpg` is the commonest mistake a customer
 * makes. Meta's own limits — see its media reference — are JPEG, PNG and static
 * WebP, at most 5 MB, 8-bit RGB or RGBA, and no edge above 4096 px.
 */

/** Interceptor and service both enforce this, so neither can be bypassed alone. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Meta rejects anything larger on an edge. */
const MAX_EDGE = 4096;

export const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

export type ImageMime = (typeof IMAGE_MIME)[number];

export interface AcceptedImage {
  ok: true;
  /** The type the bytes prove, which may differ from what the upload claimed. */
  mime: ImageMime;
  width: number | null;
  height: number | null;
}

export interface RejectedImage {
  ok: false;
  reason: string;
}

export type ImageInspection = AcceptedImage | RejectedImage;

const EXTENSIONS: Record<ImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Identifies the image by its first bytes and reads its dimensions.
 *
 * The declared MIME is not trusted: a `.jpg` that is really a PNG would be
 * accepted by Meta as PNG and rejected by us as a mismatch, which tells the
 * customer what is actually wrong. When dimensions cannot be read the file is
 * still accepted and Meta becomes the judge — a false refusal is worse than one
 * round trip.
 */
export function inspectImage(bytes: Buffer): ImageInspection {
  if (bytes.length === 0) {
    return { ok: false, reason: "The file arrived empty." };
  }

  if (bytes.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      reason: `Images are limited to ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`,
    };
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const size = jpegSize(bytes);

    return edgeCheck({ ok: true, mime: "image/jpeg", ...size });
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const size = pngSize(bytes);

    return edgeCheck({ ok: true, mime: "image/png", ...size });
  }

  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    // Animated WebP is explicitly rejected by Meta for image headers, and a
    // still frame shown where an animation was chosen would be a lie.
    if (bytes.length >= 21 && bytes.toString("ascii", 12, 16) === "VP8X") {
      const flags = bytes[20];

      if (flags & 0x02) {
        return { ok: false, reason: "Animated WebP cannot be a template header." };
      }
    }

    const size = webpSize(bytes);

    return edgeCheck({ ok: true, mime: "image/webp", ...size });
  }

  return {
    ok: false,
    reason: "Only JPEG, PNG and static WebP images can be a template header.",
  };
}

/** Extension to store under, from the type the bytes proved. */
export function extensionFor(mime: ImageMime): string {
  return EXTENSIONS[mime];
}

/**
 * A folder-safe name. `verifiedName` arrives as "Acme Pvt. Ltd." and becomes
 * `acme-pvt-ltd`, which is readable in the Storage browser and stable across
 * reconnects.
 */
export function slug(text: string | null | undefined, fallback: string): string {
  const cleaned = (text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");

  return cleaned || fallback;
}

/**
 * Where a sample is stored: `templates/{workspaceId}/{folder}/{name}-{stem}.{ext}`.
 *
 * The workspace id is the first segment because that is what the service checks
 * on the way back in. The readable folder is for humans; it is never the
 * isolation boundary, so a renamed business cannot expose another tenant's file.
 */
export function mediaPathFor(input: {
  workspaceId: string;
  folder: string;
  name: string;
  extension: string;
  /** Overridable so a test can assert the path instead of a pattern. */
  stem?: string;
}): string {
  const stem =
    input.stem ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  return [
    "templates",
    input.workspaceId,
    slug(input.folder, "workspace"),
    `${slug(input.name, "template")}-${stem}.${input.extension}`,
  ].join("/");
}

/** True when a stored path belongs to the given workspace. */
export function pathBelongsTo(path: string, workspaceId: string): boolean {
  return path.startsWith(`templates/${workspaceId}/`) && !path.includes("..");
}

function edgeCheck(image: AcceptedImage): ImageInspection {
  const widest = Math.max(image.width ?? 0, image.height ?? 0);

  if (widest > MAX_EDGE) {
    return {
      ok: false,
      reason: `The image is ${widest} px on its longest edge; Meta allows ${MAX_EDGE}.`,
    };
  }

  return image;
}

/** Walks JPEG segments until a Start Of Frame marker, which carries the size. */
function jpegSize(bytes: Buffer): { width: number | null; height: number | null } {
  let offset = 2;

  while (offset + 9 < bytes.length) {
    // Segments begin with 0xFF; padding bytes between them are also 0xFF.
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];

    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    const length = bytes.readUInt16BE(offset + 2);

    if (length < 2) return { width: null, height: null };

    const isFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isFrame && offset + 9 <= bytes.length) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }

  return { width: null, height: null };
}

/** PNG's IHDR is the first chunk, so the size sits at a fixed offset. */
function pngSize(bytes: Buffer): { width: number | null; height: number | null } {
  if (bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    return { width: null, height: null };
  }

  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Reads the size from whichever WebP chunk this file uses. */
function webpSize(bytes: Buffer): { width: number | null; height: number | null } {
  const chunk = bytes.length >= 16 ? bytes.toString("ascii", 12, 16) : "";

  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }

  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const packed = bytes.readUInt32LE(21);

    return {
      width: 1 + (packed & 0x3fff),
      height: 1 + ((packed >> 14) & 0x3fff),
    };
  }

  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }

  return { width: null, height: null };
}
