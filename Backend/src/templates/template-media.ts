import { jpegSize, pngSize, webpSize } from "../common/image-bytes";

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
