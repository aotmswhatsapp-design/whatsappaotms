#!/usr/bin/env node
/**
 * Deletes stored knowledge objects no row names.
 *
 * Dry run by default: it prints the complete candidate count and, at most, the
 * first page of them. Deleting needs `--apply --confirm <count> --max <count>`,
 * where the count is the one the dry run printed, so a stale reading cannot
 * delete a bucket that has grown since.
 *
 * The decision, the environment check and the exit codes live in
 * `src/agents/knowledge.sweep.cli.ts`, which is unit-tested; this file only
 * supplies the network and the database. Requires `npm run build`.
 *
 * Exit codes: 0 done (or dry run), 1 could not read, 2 usage/environment
 * refused, 3 deletion refused, 4 at least one delete batch failed.
 */
const fs = require("node:fs");
const path = require("node:path");

/**
 * `.env` is not loaded by Node.
 *
 * Without this the environment check cannot see the variables the app itself
 * runs with (`SUPABASE_POSTGRES_URL`, `DIRECT_URL`), and `npm run
 * knowledge:sweep` stops at its own guard. An already-set variable wins, so a
 * shell override still points the sweep somewhere else on purpose.
 */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;

    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

loadEnvFile(path.join(__dirname, "..", ".env"));

let runSweep;
try {
  ({ runSweep } = require("../dist/agents/knowledge.sweep.cli"));
} catch (error) {
  console.error("Run `npm run build` first: this script loads the compiled sweep.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const BASE = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "";
const BUCKET = process.env.AGENT_SOURCE_BUCKET ?? "";

/** One page of a prefix. A folder row has no id; the planner skips folders. */
async function list(prefix, { limit, offset }) {
  const response = await fetch(`${BASE}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      prefix,
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`list ${prefix} answered ${response.status}`);
  }

  return (await response.json()).flatMap((row) =>
    row.name
      ? [
          {
            name: row.name,
            updatedAt: row.updated_at ?? null,
            folder: row.id === null,
          },
        ]
      : [],
  );
}

/** The answer is returned, not printed: a failed batch is the caller's decision. */
async function remove(paths) {
  const response = await fetch(`${BASE}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: {
      apikey: KEY,
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ prefixes: paths }),
    signal: AbortSignal.timeout(120_000),
  });

  return { ok: response.ok, status: response.status };
}

/** Read-only: the rows are the definition of "still needed". */
async function live() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.knowledgeSource.findMany({
      where: { storagePath: { not: null } },
      select: { storagePath: true },
    });

    return new Set(rows.map((row) => row.storagePath));
  } finally {
    await prisma.$disconnect();
  }
}

runSweep(process.argv.slice(2), process.env, {
  list,
  remove,
  live,
  log: (line) => console.log(line),
  error: (line) => console.error(line),
})
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
