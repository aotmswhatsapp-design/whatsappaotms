import {
  collectObjects,
  planSweep,
  type ListedObject,
  type SweptObject,
} from "./knowledge.sweep";

/** Exit codes the operator script passes to `process.exit`. */
export const SWEEP_EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  refused: 3,
  partial: 4,
} as const;

/** Candidates listed when `--list-all` is not given; the count is always shown. */
export const PRINT_LIMIT = 200;

/** Objects per DELETE call: one failed batch is one reportable failure. */
export const DELETE_BATCH = 100;

const USAGE = [
  "Usage: npm run knowledge:sweep -- [--apply --confirm <count> --max <count>] [--list-all]",
  "",
  "  (no flags)     dry run: prints the complete candidate count and the first",
  `                 ${PRINT_LIMIT} candidates; nothing is deleted`,
  "  --list-all     print every candidate, not only the first " + PRINT_LIMIT,
  "  --apply        delete the candidates; requires --confirm and --max",
  "  --confirm <n>  the exact candidate count the dry run printed",
  "  --max <n>      the most objects this run may delete",
].join("\n");

export type SweepLister = (
  prefix: string,
  options: { limit: number; offset: number },
) => Promise<ListedObject[]>;

/** Everything that touches the outside world, so the run is testable. */
export interface SweepDeps {
  list: SweepLister;
  remove: (paths: string[]) => Promise<{ ok: boolean; status: number }>;
  live: () => Promise<Set<string>>;
  log: (line: string) => void;
  error: (line: string) => void;
  now?: () => number;
}

export interface SweepEnvironment {
  base: string;
  key: string;
  bucket: string;
  project: string;
}

export type EnvironmentVerdict =
  | { ok: true; environment: SweepEnvironment }
  | { ok: false; reason: string };

export interface SweepOptions {
  apply: boolean;
  listAll: boolean;
  confirm: string | null;
  max: number | null;
}

export type ParsedOptions =
  | { ok: true; options: SweepOptions }
  | { ok: false; reason: string };

/**
 * The project a Postgres URL belongs to.
 *
 * Supabase hands out two shapes: the direct host (`db.<ref>.supabase.co`) and
 * the pooler, where the tenant rides in the user name (`postgres.<ref>`).
 */
export function databaseProject(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(parsed.hostname);
  if (direct) return direct[1];

  const pooler = /^postgres\.([a-z0-9]+)$/i.exec(parsed.username);
  return pooler ? pooler[1] : null;
}

/** The project a storage URL belongs to: `https://<ref>.supabase.co`. */
export function storageProject(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }

  const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(host);
  return match ? match[1] : null;
}

/**
 * The database, the storage endpoint and the bucket must be one environment.
 *
 * A dry run reads the same three, and the delete is issued against whatever
 * `SUPABASE_URL` names: an environment that pairs one project's rows with
 * another project's bucket would call live files garbage. Pins
 * (`SWEEP_EXPECTED_PROJECT`, `SWEEP_EXPECTED_BUCKET`) let an operator make the
 * target explicit; when set they must match.
 */
export function resolveEnvironment(
  env: Record<string, string | undefined>,
): EnvironmentVerdict {
  const supabaseUrl = env.SUPABASE_URL?.trim() ?? "";
  if (!supabaseUrl) return { ok: false, reason: "SUPABASE_URL is not set." };

  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  const pooledUrl = env.SUPABASE_POSTGRES_URL?.trim() ?? "";

  if (databaseUrl && pooledUrl && databaseUrl !== pooledUrl) {
    return {
      ok: false,
      reason:
        "DATABASE_URL and SUPABASE_POSTGRES_URL name different databases; unset one of them.",
    };
  }

  const database = databaseUrl || pooledUrl;
  if (!database) {
    return {
      ok: false,
      reason: "DATABASE_URL (or SUPABASE_POSTGRES_URL) is not set.",
    };
  }

  const dataProject = databaseProject(database);
  if (!dataProject) {
    return {
      ok: false,
      reason: "The database URL names no Supabase project, so it cannot be matched to storage.",
    };
  }

  const filesProject = storageProject(supabaseUrl);
  if (!filesProject) {
    return { ok: false, reason: "SUPABASE_URL is not a Supabase project URL." };
  }

  if (dataProject !== filesProject) {
    return {
      ok: false,
      reason: `The database belongs to ${dataProject} but SUPABASE_URL points at ${filesProject}; refusing to clean two environments at once.`,
    };
  }

  const expectedProject = env.SWEEP_EXPECTED_PROJECT?.trim();
  if (expectedProject && expectedProject !== dataProject) {
    return {
      ok: false,
      reason: `SWEEP_EXPECTED_PROJECT is ${expectedProject} but this environment is ${dataProject}.`,
    };
  }

  const bucket = env.AGENT_SOURCE_BUCKET?.trim() ?? "";
  if (!bucket) {
    return {
      ok: false,
      reason: "AGENT_SOURCE_BUCKET is not set; refusing to guess which bucket to clean.",
    };
  }

  if (bucket === "inbox-media" || bucket === "template-media") {
    return {
      ok: false,
      reason: `AGENT_SOURCE_BUCKET is ${bucket}, which belongs to another feature's media.`,
    };
  }

  const expectedBucket = env.SWEEP_EXPECTED_BUCKET?.trim();
  if (expectedBucket && expectedBucket !== bucket) {
    return {
      ok: false,
      reason: `SWEEP_EXPECTED_BUCKET is ${expectedBucket} but AGENT_SOURCE_BUCKET is ${bucket}.`,
    };
  }

  const key =
    (env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "") ||
    (env.SUPABASE_SECRET_KEY?.trim() ?? "");
  if (!key) {
    return {
      ok: false,
      reason:
        "A service-role key is required (SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY).",
    };
  }

  return {
    ok: true,
    environment: {
      base: supabaseUrl.replace(/\/+$/, ""),
      key,
      bucket,
      project: dataProject,
    },
  };
}

/** `--flag` parsing; anything unrecognised is a usage error, not a surprise. */
export function parseSweepArgs(argv: string[]): ParsedOptions {
  const options: SweepOptions = {
    apply: false,
    listAll: false,
    confirm: null,
    max: null,
  };

  for (let at = 0; at < argv.length; at += 1) {
    const argument = argv[at];

    if (argument === "--apply") {
      options.apply = true;
      continue;
    }

    if (argument === "--list-all") {
      options.listAll = true;
      continue;
    }

    if (argument === "--confirm" || argument === "--max") {
      const value = argv[at + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, reason: `${argument} needs a value.` };
      }

      if (argument === "--confirm") {
        options.confirm = value;
      } else {
        const max = Number(value);
        if (!Number.isInteger(max) || max < 1) {
          return { ok: false, reason: `--max needs a whole number of at least 1.` };
        }
        options.max = max;
      }

      at += 1;
      continue;
    }

    return { ok: false, reason: `Unknown argument: ${argument}` };
  }

  return { ok: true, options };
}

/**
 * One sweep, from environment check to exit code.
 *
 * The order is deliberate: the environment is checked before the database is
 * read, the complete count is printed before anything is deleted, and a delete
 * needs the count the operator was shown — a stale confirmation is refused
 * rather than applied to a list that has grown since.
 */
export async function runSweep(
  argv: string[],
  env: Record<string, string | undefined>,
  deps: SweepDeps,
): Promise<number> {
  const parsed = parseSweepArgs(argv);

  if (!parsed.ok) {
    deps.error(parsed.reason);
    deps.error(USAGE);
    return SWEEP_EXIT.usage;
  }

  const options = parsed.options;
  const verdict = resolveEnvironment(env);

  if (!verdict.ok) {
    deps.error(verdict.reason);
    return SWEEP_EXIT.usage;
  }

  const environment = verdict.environment;

  deps.log(`project ${environment.project}, bucket ${environment.bucket}`);
  deps.log(
    options.apply
      ? "Mode: APPLY — candidates will be deleted."
      : "Mode: dry run — nothing is deleted.",
  );

  let orphans: SweptObject[];
  let objectCount: number;
  let liveCount: number;

  try {
    const live = await deps.live();
    const objects = await collectObjects(deps.list, ["workspaces/", "agents/"]);

    orphans = planSweep({ objects, live, now: deps.now?.() ?? Date.now() });
    objectCount = objects.length;
    liveCount = live.size;
  } catch (error) {
    deps.error(
      `Could not read the bucket: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return SWEEP_EXIT.failed;
  }

  // The complete count, whatever the printing limit: an operator confirming a
  // deletion must see how many objects the confirmation covers.
  deps.log(
    `${objectCount} objects, ${liveCount} referenced, ${orphans.length} orphaned`,
  );

  const printed = options.listAll ? orphans : orphans.slice(0, PRINT_LIMIT);

  for (const orphan of printed) {
    deps.log(`${options.apply ? "delete" : "would delete"} ${orphan.path}`);
  }

  if (printed.length < orphans.length) {
    deps.log(
      `… ${orphans.length - printed.length} more; re-run with --list-all to print every candidate.`,
    );
  }

  if (!options.apply) {
    deps.log(
      `Dry run: nothing was deleted. To delete, re-run with --apply --confirm ${orphans.length} --max ${orphans.length}.`,
    );
    return SWEEP_EXIT.ok;
  }

  if (options.confirm === null || options.max === null) {
    deps.error(
      `Refusing to delete: --apply needs --confirm ${orphans.length} and --max <count>.`,
    );
    return SWEEP_EXIT.refused;
  }

  if (options.confirm !== String(orphans.length)) {
    deps.error(
      `Refusing to delete: --confirm ${options.confirm} does not match the ${orphans.length} candidates found. Re-read the dry run.`,
    );
    return SWEEP_EXIT.refused;
  }

  if (orphans.length > options.max) {
    deps.error(
      `Refusing to delete: ${orphans.length} candidates exceed --max ${options.max}. Raise the limit deliberately.`,
    );
    return SWEEP_EXIT.refused;
  }

  const failures: string[] = [];
  let deleted = 0;

  for (let at = 0; at < orphans.length; at += DELETE_BATCH) {
    const batch = orphans.slice(at, at + DELETE_BATCH).map((orphan) => orphan.path);
    const label = `batch ${at / DELETE_BATCH + 1} (${batch.length} paths)`;

    // One failed batch does not hide the rest: the others are still attempted,
    // and the exit code carries the fact that the sweep is incomplete.
    try {
      const answer = await deps.remove(batch);

      if (!answer.ok) {
        failures.push(`${label} answered ${answer.status}`);
        continue;
      }

      deleted += batch.length;
      deps.log(`deleted ${batch.length} objects`);
    } catch (error) {
      failures.push(
        `${label} failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  if (failures.length > 0) {
    deps.error(
      `${failures.length} deletion batch${failures.length === 1 ? "" : "es"} failed:`,
    );

    for (const failure of failures) deps.error(`  ${failure}`);

    deps.error(`Deleted ${deleted} of ${orphans.length}. Re-run the dry run before trying again.`);
    return SWEEP_EXIT.partial;
  }

  deps.log(`Deleted ${deleted} orphaned objects.`);
  return SWEEP_EXIT.ok;
}
