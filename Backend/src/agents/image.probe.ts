import { gifSize, jpegSize, pngSize, webpSize } from "../common/image-bytes";

export type ProbedImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** The type the bytes prove, and its pixel size when it can be read.
 *
 *  GIF is here although a template header cannot be one: a training image may
 *  be, and its row should say how large it is. */
export function probeImage(
  bytes: Buffer,
): { mime: ProbedImageMime; width: number | null; height: number | null } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ...jpegSize(bytes) };
  }

  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: "image/png", ...pngSize(bytes) };
  }

  if (
    bytes.length >= 12 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return { mime: "image/webp", ...webpSize(bytes) };
  }

  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString("latin1", 0, 6))) {
    return { mime: "image/gif", ...gifSize(bytes) };
  }

  return null;
}
