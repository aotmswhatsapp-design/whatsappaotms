import assert from "node:assert/strict";
import { test } from "node:test";

import { LocalKnowledgeSearch } from "./local.search";

/** Enough configuration for the engine; the default floor is what we want. */
const config = { get: () => undefined };

/** One row in the shape the query returns. */
const ROW = {
  id: "c-1",
  text: "Dosa 80",
  source_id: "s-1",
  title: "Menu",
  mime: "text/csv",
  page: null,
  sheet: "Menu",
  row_from: 1,
  row_to: 1,
  heading: null,
  rank: 0.5,
  similarity: 0.9,
  all_terms: true,
  some_terms: true,
};

/**
 * A Prisma stand-in that records each statement it is asked to run, and can
 * fail the first one the way a database without `pg_trgm` does.
 */
function recorder(rows: unknown[], failure?: string) {
  const statements: string[] = [];
  let calls = 0;

  const prisma = {
    $queryRaw: (strings: TemplateStringsArray) => {
      calls += 1;
      statements.push(strings.join(" ? "));

      return calls === 1 && failure
        ? Promise.reject(new Error(failure))
        : Promise.resolve(rows);
    },
  };

  return { statements, prisma };
}

const build = (rows: unknown[], failure?: string) => {
  const { statements, prisma } = recorder(rows, failure);

  return {
    statements,
    engine: new LocalKnowledgeSearch(prisma as never, config as never),
  };
};

test("the local engine reads one agent's material and nobody else's", async () => {
  const { statements, engine } = build([ROW]);

  const result = await engine.search(
    { agentId: "agent-1", workspaceId: "ws-a" },
    "dosa",
  );

  // The row came back in the caller's shape, with a confidence on it.
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].title, "Menu");
  assert.ok(result.chunks[0].score > 0);

  const sql = statements.join(" ");
  assert.match(sql, /s\.agent_id/);
  assert.match(sql, /a\.workspace_id/);
  assert.match(sql, /s\.status = 'READY'/);
});

test("a question with no subject never reaches the database", async () => {
  const { statements, engine } = build([ROW]);

  const result = await engine.search(
    { agentId: "agent-1", workspaceId: "ws-a" },
    "hello",
  );

  assert.deepEqual(result, { chunks: [] });
  assert.equal(statements.length, 0);
});

test("a database without pg_trgm still answers on full text", async () => {
  const { statements, engine } = build(
    [ROW],
    "function word_similarity(text, text) does not exist",
  );

  const result = await engine.search(
    { agentId: "agent-1", workspaceId: "ws-a" },
    "dosa",
  );

  assert.equal(result.chunks.length, 1);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /word_similarity/);
  // The retry must not mention the function whose absence caused it.
  assert.doesNotMatch(statements[1], /word_similarity/);
  // And it is still scoped: the fallback is not a licence to read everything.
  assert.match(statements[1], /s\.agent_id/);
  assert.match(statements[1], /a\.workspace_id/);
});

test("a real database failure is not mistaken for a missing extension", async () => {
  const { statements, engine } = build(
    [ROW],
    "permission denied for table knowledge_chunks",
  );

  await assert.rejects(
    engine.search({ agentId: "agent-1", workspaceId: "ws-a" }, "dosa"),
    /permission denied/,
  );

  assert.equal(statements.length, 1);
});
