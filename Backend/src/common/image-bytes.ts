/**
 * Pixel sizes read from an image's own bytes.
 *
 * Two features need the same walkers for different reasons: Meta caps a
 * template header at 4096 px, and a training image records the dimensions it
 * really has. The code is identical, so it lives here rather than in either
 * feature, and every reader returns nulls instead of refusing — a size that
 * cannot be read must not reject an image the feature can otherwise accept.
 */

/** Walks JPEG segments until a Start Of Frame marker, which carries the size. */
export function jpegSize(bytes: Buffer): { width: number | null; height: number | null } {
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
export function pngSize(bytes: Buffer): { width: number | null; height: number | null } {
  if (bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    return { width: null, height: null };
  }

  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Reads the size from whichever WebP chunk this file uses. */
export function webpSize(bytes: Buffer): { width: number | null; height: number | null } {
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

/** GIF89a and GIF87a store width and height as little-endian words at 6 and 8. */
export function gifSize(bytes: Buffer): { width: number | null; height: number | null } {
  if (bytes.length < 10) return { width: null, height: null };
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}
