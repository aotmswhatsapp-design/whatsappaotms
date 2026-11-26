/**
 * How long an object may be unreferenced before it is treated as garbage.
 *
 * An upload writes bytes before its row, so a short window would delete a file
 * whose insert is still in flight. A day is longer than any upload and shorter
 * than an operator's patience.
 */
export const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;

/** One stored object, as the bucket lists it. */
export interface SweptObject {
  path: string;
  updatedAt: string | null;
}

/** One entry a listing returns: an object or a folder. */
export interface ListedObject {
  name: string;
  updatedAt: string | null;
  folder: boolean;
}

/**
 * Orphans are objects no row names, older than the grace period.
 *
 * An object with no usable timestamp is never deleted: "unknown age" is not
 * evidence of garbage, and a false positive here destroys a customer's file.
 */
export function planSweep(input: {
  objects: SweptObject[];
  live: Set<string>;
  now: number;
  graceMs?: number;
}): SweptObject[] {
  const grace = input.graceMs ?? SWEEP_GRACE_MS;

  return input.objects.filter((object) => {
    if (input.live.has(object.path)) return false;
    if (!object.updatedAt) return false;

    const at = Date.parse(object.updatedAt);
    if (Number.isNaN(at)) return false;

    return input.now - at >= grace;
  });
}

/**
 * Walks the path families and returns object paths, folders excluded.
 *
 * The lister is injected rather than taken from `MediaStorage`: that client's
 * `list` cannot say whether a row is a folder, and giving it a folder flag to
 * serve an operator script would change a class the inbox depends on.
 */
export async function collectObjects(
  list: (
    prefix: string,
    options: { limit: number; offset: number },
  ) => Promise<ListedObject[]>,
  roots: string[],
  depth = 0,
): Promise<SweptObject[]> {
  const out: SweptObject[] = [];

  for (const root of roots) {
    let offset = 0;

    for (;;) {
      const page = await list(root, { limit: 1000, offset });
      if (page.length === 0) break;

      for (const entry of page) {
        const path = `${root}${root.endsWith("/") ? "" : "/"}${entry.name}`;

        if (entry.folder) {
          if (depth < 6) out.push(...(await collectObjects(list, [`${path}/`], depth + 1)));
          continue;
        }

        out.push({ path, updatedAt: entry.updatedAt });
      }

      // A short page is the last one; anything else would re-read it for ever.
      if (page.length < 1000) break;
      offset += 1000;
    }
  }

  return out;
}
