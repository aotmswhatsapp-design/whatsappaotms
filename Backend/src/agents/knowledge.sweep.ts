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

/** One page of a listing. */
export const SWEEP_PAGE = 1000;

/**
 * A stop for a listing that never ends.
 *
 * Reaching it is an error, not a short answer: a cleaner that silently stops
 * early leaves garbage, and one that loops for ever never returns a count.
 */
export const MAX_PAGES = 1000;

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
  seen: Set<string> = new Set(),
): Promise<SweptObject[]> {
  const out: SweptObject[] = [];

  for (const root of roots) {
    let offset = 0;

    for (let pages = 0; ; pages += 1) {
      const page = await list(root, { limit: SWEEP_PAGE, offset });
      if (page.length === 0) break;

      // The offset advances by what the page actually held, never by the page
      // size: a listing that caps below the requested limit would otherwise
      // skip entries, and skipped entries are never counted as orphans.
      offset += page.length;

      const before = out.length;

      for (const entry of page) {
        const path = `${root}${root.endsWith("/") ? "" : "/"}${entry.name}`;

        if (entry.folder) {
          const prefix = `${path}/`;
          if (depth < 6 && !seen.has(prefix)) {
            seen.add(prefix);
            out.push(...(await collectObjects(list, [prefix], depth + 1, seen)));
          }
          continue;
        }

        // A page read twice must not produce a path twice: the caller deletes
        // by path, and a duplicate is a second delete of the same object.
        if (seen.has(path)) continue;
        seen.add(path);
        out.push({ path, updatedAt: entry.updatedAt });
      }

      countOrThrow(root, pages);

      // A page that added nothing is a listing that ignores the offset: paging
      // on would walk the same entries for ever. A short page is not the end,
      // because an endpoint may cap below the requested limit — only an empty
      // page (or this no-progress test) finishes a prefix.
      if (out.length === before) break;
    }
  }

  return out;
}

function countOrThrow(root: string, pages: number): void {
  if (pages + 1 >= MAX_PAGES) {
    throw new Error(`Listing ${root} did not finish within ${MAX_PAGES} pages.`);
  }
}
