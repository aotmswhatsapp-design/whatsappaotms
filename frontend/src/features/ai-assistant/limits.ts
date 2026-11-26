/**
 * What the upload routes accept, in one place.
 *
 * The training dropzone and the "replace this file" control must offer exactly
 * the same files, and the backend's allowlist is the authority both mirror:
 * `knowledge.file.ts` on the API side names these same 19 extensions, and the
 * bytes — not the browser's MIME — are what it finally trusts.
 */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** What the file picker offers. A drag bypasses it and the server decides. */
export const ACCEPT_ATTRIBUTE = [
  ".txt",
  ".md",
  ".csv",
  ".docx",
  ".xlsx",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ogg",
  ".oga",
  ".mp3",
  ".m4a",
  ".wav",
  ".flac",
  ".opus",
  ".webm",
].join(",");

/**
 * The copy the server would refuse a file for on size, or null. Only the size
 * is checked here — a 25 MB body is worth refusing before it is sent, while
 * every other refusal is the server's to make and to word.
 */
export function sizeRejection(file: File): string | null {
  if (file.size <= MAX_SOURCE_BYTES) return null;

  return `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 25 MB.`;
}
