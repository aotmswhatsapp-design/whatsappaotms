import sharp from "sharp";

import { inspectImage } from "../templates/template-media";

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
