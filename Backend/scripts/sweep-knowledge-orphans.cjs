#!/usr/bin/env node
/**
 * Deletes stored knowledge objects no row names.
 *
 * Dry run by default; `--apply` is the only way to delete. Run it against a
 * development project first: it reads whatever `DATABASE_URL` and
 * `SUPABASE_URL` point at. Requires `npm run build`, because it loads the
 * compiled planner from `dist/`.
 */
const { PrismaClient } = require("@prisma/client");
const { collectObjects, planSweep } = require("../dist/agents/knowledge.sweep");

const BUCKET = process.env.AGENT_SOURCE_BUCKET ?? "agent-sources";
const BASE = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "";
const APPLY = process.argv.includes("--apply");
const BATCH = 100;

if (!BASE || !KEY) {
  console.error("SUPABASE_URL and a service-role key are required.");
  process.exit(1);
}

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

  if (!response.ok) {
    console.error(`delete batch answered ${response.status}`);
  }
}

(async () => {
  const prisma = new PrismaClient();

  try {
    // Read-only: the rows are the definition of "still needed".
    const rows = await prisma.knowledgeSource.findMany({
      where: { storagePath: { not: null } },
      select: { storagePath: true },
    });

    const live = new Set(rows.map((row) => row.storagePath));
    const objects = await collectObjects(list, ["workspaces/", "agents/"]);
    const orphans = planSweep({ objects, live, now: Date.now() });

    // Printed before anything is deleted, so the operator can see the project
    // their environment points at.
    console.log(`bucket ${BUCKET} at ${BASE}`);
    console.log(
      `${objects.length} objects, ${live.size} referenced, ${orphans.length} orphaned`,
    );

    for (const orphan of orphans.slice(0, 200)) {
      console.log(`${APPLY ? "delete" : "would delete"} ${orphan.path}`);
    }

    if (orphans.length > 200) {
      console.log(`… ${orphans.length - 200} more`);
    }

    if (APPLY) {
      for (let at = 0; at < orphans.length; at += BATCH) {
        await remove(orphans.slice(at, at + BATCH).map((orphan) => orphan.path));
      }
    } else {
      console.log("Dry run. Re-run with --apply to delete.");
    }
  } finally {
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
