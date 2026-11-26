import assert from "node:assert/strict";
import { test } from "node:test";

import {
  databaseProject,
  parseSweepArgs,
  runSweep,
  storageProject,
  SWEEP_EXIT,
  type SweepDeps,
} from "./knowledge.sweep.cli";

const PROJECT = "vjumchunmclicwvyjlct";

const env = (overrides: Record<string, string | undefined> = {}) => ({
  SUPABASE_URL: `https://${PROJECT}.supabase.co`,
  DATABASE_URL: `postgresql://postgres.${PROJECT}:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
  AGENT_SOURCE_BUCKET: "agent-sources",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  ...overrides,
});

/**
 * A bucket holding `count` unreferenced, long-stale objects.
 *
 * The timestamps are old enough that the grace period keeps nothing back, so
 * the candidate count is exactly `count`.
 */
const harness = (count: number) => {
  const lines: string[] = [];
  const errors: string[] = [];
  const removed: string[][] = [];
  let listCalls = 0;

  const deps: SweepDeps = {
    list: async (prefix, { limit, offset }) => {
      listCalls += 1;
      if (prefix !== "workspaces/") return [];

      return Array.from(
        { length: Math.max(0, Math.min(limit, count - offset)) },
        (_, at) => ({
          name: `f${offset + at}`,
          updatedAt: "2020-01-01T00:00:00Z",
          folder: false,
        }),
      );
    },
    remove: async (paths) => {
      removed.push(paths);
      return { ok: true, status: 200 };
    },
    live: async () => new Set<string>(),
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
    now: () => Date.parse("2026-11-26T00:00:00Z"),
  };

  return {
    deps,
    lines,
    errors,
    removed,
    get listCalls() {
      return listCalls;
    },
  };
};

test("the project is read from both URL shapes", () => {
  assert.equal(
    databaseProject(`postgresql://postgres.${PROJECT}:pw@host:5432/postgres`),
    PROJECT,
  );
  assert.equal(
    databaseProject(`postgresql://postgres:pw@db.${PROJECT}.supabase.co:5432/postgres`),
    PROJECT,
  );
  assert.equal(storageProject(`https://${PROJECT}.supabase.co`), PROJECT);
  assert.equal(databaseProject("not a url"), null);
});

test("a database and a bucket from different projects are refused before reading either", async () => {
  const { deps, errors } = harness(0);
  let read = false;
  deps.live = async () => {
    read = true;
    return new Set();
  };

  const code = await runSweep(
    [],
    env({ SUPABASE_URL: "https://zkykkvlyvqlixqlrughb.supabase.co" }),
    deps,
  );

  assert.equal(code, SWEEP_EXIT.usage);
  assert.equal(read, false);
  assert.match(errors[0], /refusing to clean two environments at once/);
});

test("two database URLs that disagree are refused", async () => {
  const { deps, errors } = harness(0);

  const code = await runSweep(
    [],
    env({ SUPABASE_POSTGRES_URL: env().DATABASE_URL.replace(PROJECT, "otheproject") }),
    deps,
  );

  assert.equal(code, SWEEP_EXIT.usage);
  assert.match(errors[0], /name different databases/);
});

test("an unnamed bucket is refused, and so is another feature's", async () => {
  const missing = harness(0);
  assert.equal(
    await runSweep([], env({ AGENT_SOURCE_BUCKET: undefined }), missing.deps),
    SWEEP_EXIT.usage,
  );
  assert.match(missing.errors[0], /AGENT_SOURCE_BUCKET is not set/);

  const wrong = harness(0);
  assert.equal(
    await runSweep([], env({ AGENT_SOURCE_BUCKET: "inbox-media" }), wrong.deps),
    SWEEP_EXIT.usage,
  );
  assert.match(wrong.errors[0], /belongs to another feature/);
});

test("a pin for another project is refused", async () => {
  const { deps, errors } = harness(0);

  const code = await runSweep(
    [],
    env({ SWEEP_EXPECTED_PROJECT: "anotherproject" }),
    deps,
  );

  assert.equal(code, SWEEP_EXIT.usage);
  assert.match(errors[0], /SWEEP_EXPECTED_PROJECT/);
});

test("a dry run prints the complete count, a bounded list and deletes nothing", async () => {
  const { deps, lines, removed } = harness(250);

  const code = await runSweep([], env(), deps);

  assert.equal(code, SWEEP_EXIT.ok);
  assert.equal(removed.length, 0);
  // The count is complete even though the listing is not.
  assert.ok(lines.some((line) => line.includes("250 orphaned")));
  assert.equal(
    lines.filter((line) => line.startsWith("would delete ")).length,
    200,
  );
  assert.ok(lines.some((line) => line.includes("50 more")));
  assert.match(lines.at(-1)!, /--apply --confirm 250 --max 250/);
});

test("--list-all prints every candidate", async () => {
  const { deps, lines } = harness(250);

  const code = await runSweep(["--list-all"], env(), deps);

  assert.equal(code, SWEEP_EXIT.ok);
  assert.equal(
    lines.filter((line) => line.startsWith("would delete ")).length,
    250,
  );
  assert.equal(lines.some((line) => line.includes("more;")), false);
});

test("--apply without a confirmation and a limit deletes nothing", async () => {
  const { deps, errors, removed } = harness(3);

  const code = await runSweep(["--apply"], env(), deps);

  assert.equal(code, SWEEP_EXIT.refused);
  assert.equal(removed.length, 0);
  assert.match(errors[0], /--confirm 3/);
});

test("a confirmation that does not match the count is refused", async () => {
  const { deps, errors, removed } = harness(3);

  const code = await runSweep(
    ["--apply", "--confirm", "4", "--max", "10"],
    env(),
    deps,
  );

  assert.equal(code, SWEEP_EXIT.refused);
  assert.equal(removed.length, 0);
  assert.match(errors[0], /does not match the 3 candidates/);
});

test("a limit below the candidate count is refused", async () => {
  const { deps, errors, removed } = harness(3);

  const code = await runSweep(
    ["--apply", "--confirm", "3", "--max", "2"],
    env(),
    deps,
  );

  assert.equal(code, SWEEP_EXIT.refused);
  assert.equal(removed.length, 0);
  assert.match(errors[0], /exceed --max 2/);
});

test("a confirmed run deletes in batches and succeeds", async () => {
  const { deps, lines, removed } = harness(150);

  const code = await runSweep(
    ["--apply", "--confirm", "150", "--max", "150"],
    env(),
    deps,
  );

  assert.equal(code, SWEEP_EXIT.ok);
  assert.deepEqual(removed.map((batch) => batch.length), [100, 50]);
  assert.ok(lines.some((line) => line.includes("Deleted 150 orphaned objects")));
});

test("the listing is read before the reference set", async () => {
  const { deps } = harness(0);
  const order: string[] = [];

  deps.list = async () => {
    order.push("list");
    return [];
  };
  deps.live = async () => {
    order.push("live");
    return new Set<string>();
  };

  await runSweep([], env(), deps);

  // Every listed object is judged against references at least as new as it.
  assert.equal(order.filter((step) => step === "live").length, 1);
  assert.ok(
    order.indexOf("live") > order.lastIndexOf("list"),
    `listing must finish before the reference set is read: ${order.join(", ")}`,
  );
});

test("a candidate that becomes referenced after the plan is kept, and the run is partial", async () => {
  const { deps, lines, errors, removed } = harness(3);

  // The first read draws the plan; every later read — the recheck before the
  // batch is deleted — shows that the middle path acquired a reference.
  let reads = 0;
  deps.live = async () => {
    reads += 1;
    return reads === 1
      ? new Set<string>()
      : new Set(["workspaces/f1"]);
  };

  const code = await runSweep(
    ["--apply", "--confirm", "3", "--max", "3"],
    env(),
    deps,
  );

  assert.equal(code, SWEEP_EXIT.partial);
  // The newly referenced path never reached the delete.
  assert.deepEqual(removed, [["workspaces/f0", "workspaces/f2"]]);
  assert.ok(lines.some((line) => line.includes("kept 1 candidate")));
  assert.match(errors[0], /Kept 1 candidate/);
});

test("a failed deletion batch is non-zero, and the rest is still attempted", async () => {
  const { deps, errors, removed } = harness(150);
  let call = 0;

  deps.remove = async (paths) => {
    removed.push(paths);
    call += 1;
    return call === 1 ? { ok: false, status: 500 } : { ok: true, status: 200 };
  };

  const code = await runSweep(
    ["--apply", "--confirm", "150", "--max", "150"],
    env(),
    deps,
  );

  assert.equal(code, SWEEP_EXIT.partial);
  assert.equal(removed.length, 2);
  assert.match(errors[0], /1 deletion batch failed/);
  assert.ok(errors.some((line) => line.includes("Deleted 50 of 150")));
});

test("a batch that throws is a failure, not an unhandled rejection", async () => {
  const { deps, errors } = harness(10);

  deps.remove = async () => {
    throw new Error("socket closed");
  };

  const code = await runSweep(
    ["--apply", "--confirm", "10", "--max", "10"],
    env(),
    deps,
  );

  assert.equal(code, SWEEP_EXIT.partial);
  assert.ok(errors.some((line) => line.includes("socket closed")));
});

test("an unknown flag is a usage error", async () => {
  const { deps, errors } = harness(0);

  const code = await runSweep(["--force"], env(), deps);

  assert.equal(code, SWEEP_EXIT.usage);
  assert.match(errors[0], /Unknown argument: --force/);
});

test("--max needs a positive whole number", () => {
  const parsed = parseSweepArgs(["--apply", "--max", "0"]);
  assert.equal(parsed.ok, false);
});
