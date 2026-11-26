import assert from "node:assert/strict";
import { test } from "node:test";

import { KnowledgeService } from "./knowledge.service";
import { CLAIMS, searchConfig } from "./testing/fakes";

const TOK_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TOK_B = "bbbbbbbb-0000-4000-8000-000000000002";
const TOK_C = "cccccccc-0000-4000-8000-000000000003";

type Status = "PENDING" | "PROCESSING" | "READY" | "FAILED";

interface Row {
  id: string;
  agentId: string;
  kind: "TEXT" | "FILE";
  title: string;
  mime: string | null;
  size: number | null;
  storagePath: string | null;
  text: string | null;
  meta: unknown;
  extractTokens: number;
  status: Status;
  leaseToken: string | null;
  attempts: number;
  error: string | null;
  charCount: number;
  chunkCount: number;
  embedTokens: number;
  indexedAt: Date | null;
  replacesSourceId: string | null;
  sha256: string | null;
  createdAt: Date;
  updatedAt: Date;
  agent: { model: string };
}

interface Chunk {
  sourceId: string;
  text: string;
  embedding: unknown;
}

/**
 * One row and its chunks, mutated exactly as the statements would.
 *
 * The point is shared state: the worker under test, the reaper, the retry and
 * the next claim all run against this object, so an interleaving is real rather
 * than a scripted sequence of call arguments.
 */
class LeasedTable {
  row: Row = {
    id: "src-1",
    agentId: "agent-1",
    kind: "TEXT",
    title: "note",
    mime: null,
    size: null,
    storagePath: null,
    text: "hello there",
    meta: null,
    extractTokens: 0,
    status: "PROCESSING",
    leaseToken: null,
    attempts: 0,
    error: null,
    charCount: 0,
    chunkCount: 0,
    embedTokens: 0,
    indexedAt: null,
    replacesSourceId: null,
    sha256: null,
    createdAt: new Date(Date.parse("2026-01-01T00:00:00Z")),
    updatedAt: new Date(),
    agent: { model: "gpt-4o-mini" },
  };

  chunks = new Map<string, Chunk>();
  /** Every write that landed, in order, so "nothing happened" is provable. */
  writes: string[] = [];
  /** Every SQL text seen by `$executeRaw`, for the source predicate. */
  sql: string[] = [];
  /** When true the vector update matches no row, as a replaced chunk would. */
  vectorMiss = false;

  private nextId = 0;

  knowledgeSource = {
    findUnique: async (args: any) =>
      args.where.id === this.row.id ? { ...this.row } : null,
    findUniqueOrThrow: async () => ({ ...this.row }),
    findFirst: async () => ({ ...this.row }),
    count: async () => 0,
    findMany: async (args: any) => (this.matches(args.where) ? [{ ...this.row }] : []),
    updateMany: async (args: any) => {
      if (!this.matches(args.where)) return { count: 0 };

      this.apply(args.data);
      this.writes.push(`row:${JSON.stringify(args.data, replacer)}`);
      return { count: 1 };
    },
    create: async (args: any) => ({ ...this.row, ...args.data }),
  };

  knowledgeChunk = {
    deleteMany: async (args: any) => {
      if (args.where.source && this.row.status !== args.where.source.status) {
        return { count: 0 };
      }

      const ids: string[] = args.where.sourceId?.in ?? [args.where.sourceId];
      let removed = 0;

      for (const [id, chunk] of this.chunks) {
        if (ids.includes(chunk.sourceId)) {
          this.chunks.delete(id);
          removed += 1;
        }
      }

      this.writes.push(`chunks:delete:${removed}`);
      return { count: removed };
    },
    createMany: async (args: any) => {
      for (const draft of args.data) {
        this.nextId += 1;
        this.chunks.set(`c${this.nextId}`, {
          sourceId: draft.sourceId,
          text: draft.text,
          embedding: null,
        });
      }

      this.writes.push(`chunks:create:${args.data.length}`);
      return { count: args.data.length };
    },
    findMany: async (args: any) =>
      [...this.chunks.entries()]
        .filter(([, chunk]) => chunk.sourceId === args.where.sourceId)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, chunk]) => ({ id, text: chunk.text })),
  };

  agent = {
    findFirst: async (args: any) => ({
      id: args.where.id,
      workspaceId: args.where.workspaceId,
      name: "agent",
      description: null,
      model: "gpt-4o-mini",
      isActive: true,
      whatsappAccountId: "wa-1",
    }),
  };

  $executeRaw = async (strings: TemplateStringsArray, ...values: any[]) => {
    this.sql.push(strings.join(" ? "));

    const [embedding, id, sourceId] = values;
    const chunk = this.vectorMiss ? undefined : this.chunks.get(id);

    if (!chunk || chunk.sourceId !== sourceId) {
      this.writes.push(`vector:miss:${id}`);
      return 0;
    }

    chunk.embedding = embedding;
    this.writes.push(`vector:${id}`);
    return 1;
  };

  $transaction = async (input: any, _options?: any) =>
    Array.isArray(input) ? Promise.all(input) : input(this);

  private matches(where: any): boolean {
    if (where.id !== undefined) {
      if (typeof where.id === "string") {
        if (where.id !== this.row.id) return false;
      } else {
        if (where.id.in && !where.id.in.includes(this.row.id)) return false;
        if (where.id.not && this.row.id === where.id.not) return false;
      }
    }

    if (where.agentId !== undefined && where.agentId !== this.row.agentId) return false;

    if (where.status !== undefined) {
      if (typeof where.status === "string") {
        if (this.row.status !== where.status) return false;
      } else {
        if (where.status.in && !where.status.in.includes(this.row.status)) return false;
        if (where.status.not && this.row.status === where.status.not) return false;
      }
    }

    if (
      typeof where.leaseToken === "string" &&
      this.row.leaseToken !== where.leaseToken
    ) {
      return false;
    }

    if (
      where.updatedAt?.lt instanceof Date &&
      !(this.row.updatedAt < where.updatedAt.lt)
    ) {
      return false;
    }

    if (
      where.attempts?.gte !== undefined &&
      this.row.attempts < where.attempts.gte
    ) {
      return false;
    }

    return true;
  }

  private apply(data: any): void {
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && typeof value === "object" && "increment" in (value as any)) {
        (this.row as any)[key] =
          ((this.row as any)[key] ?? 0) + (value as any).increment;
        continue;
      }

      (this.row as any)[key] = value;
    }

    this.row.updatedAt = new Date();
  }
}

const replacer = (_key: string, value: unknown) =>
  value instanceof Date ? value.toISOString() : value;

/** A worker that can be held inside `embed`, then released. */
class Gate {
  private arrived!: () => void;
  private open!: () => void;

  readonly entered = new Promise<void>((resolve) => (this.arrived = resolve));
  readonly released = new Promise<void>((resolve) => (this.open = resolve));

  arrive(): void {
    this.arrived();
  }

  release(): void {
    this.open();
  }
}

const build = (db: LeasedTable, provider: unknown) =>
  new KnowledgeService(
    db as any,
    {
      primaryFor: async () => ({
        workspaceId: "ws-a",
        userId: "user-a",
        role: "OWNER" as const,
      }),
    } as any,
    { download: async () => Buffer.alloc(0), remove: async () => undefined } as any,
    provider as any,
    {} as any,
    searchConfig() as any,
  );

test("a resumed worker cannot delete or modify the chunks of the claim that replaced it", async () => {
  const db = new LeasedTable();
  const gate = new Gate();
  const phase: { at: "a" | "b" | "c" } = { at: "a" };

  const provider = {
    embed: async (input: string[]) => {
      if (phase.at === "a") {
        gate.arrive();
        await gate.released;
        return { vectors: input.map(() => new Array(1536).fill(0.25)), tokens: 11 };
      }

      if (phase.at === "b") throw new Error("provider down");

      return { vectors: input.map(() => new Array(1536).fill(0.5)), tokens: 3 };
    },
  };

  const service = build(db, provider);

  // A holds the first claim and is in the middle of embedding.
  db.row.status = "PROCESSING";
  db.row.leaseToken = TOK_A;
  const a = service.index("src-1", TOK_A);

  await gate.entered;
  assert.ok(db.chunks.size > 0, "A wrote its chunks before the interleaving");

  // A stopped renewing: the reaper hands the row on under a fresh number.
  db.row.updatedAt = new Date(Date.now() - 60 * 60 * 1000);
  await service.recoverStale();

  assert.equal(db.row.status, "PENDING");
  assert.equal(db.row.leaseToken, null, "recovery invalidates the old token");
  assert.equal(db.row.attempts, 1);

  // B claims it and fails.
  phase.at = "b";
  db.row.status = "PROCESSING";
  db.row.leaseToken = TOK_B;
  db.row.updatedAt = new Date();
  await service.index("src-1", TOK_B);

  assert.equal(db.row.status, "FAILED");
  assert.equal(db.row.leaseToken, null);
  assert.equal(db.chunks.size, 0, "the failed attempt took its own chunks");

  // The user retries: the queued row carries no token at all.
  await service.retry(CLAIMS, "agent-1", "src-1");

  assert.equal(db.row.status, "PENDING");
  assert.equal(db.row.leaseToken, null, "retry never reuses a token");
  assert.equal(db.row.attempts, 0);

  // C claims and finishes.
  phase.at = "c";
  db.row.status = "PROCESSING";
  db.row.leaseToken = TOK_C;
  db.row.updatedAt = new Date();
  await service.index("src-1", TOK_C);

  assert.equal(db.row.status, "READY");
  const cChunks = new Map([...db.chunks].map(([id, chunk]) => [id, { ...chunk }]));
  const writesBeforeResume = db.writes.length;

  // A wakes up. Its token is an old value that the row no longer carries.
  gate.release();
  await a;

  assert.equal(db.row.status, "READY");
  assert.equal(db.row.leaseToken, null);
  assert.deepEqual(db.chunks, cChunks, "C's chunks and embeddings are untouched");
  assert.equal(db.writes.length, writesBeforeResume, "A wrote nothing at all");
});

test("a claim mints a fresh token inside the claiming statement", async () => {
  const tokens: string[] = [];
  const sql: string[] = [];

  const prisma = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
      sql.push(strings.join(" ? "));
      tokens.push(values[0]);
      return [{ id: `src-${tokens.length}`, leaseToken: values[0] }];
    },
  };

  const service = new KnowledgeService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    searchConfig() as any,
  );

  const first = await service.claim();
  const second = await service.claim();

  // The token is written by the same UPDATE that takes the row, as a bound
  // parameter, so no server function has to exist for the claim to be safe.
  // (The fake renders the bound value as `?`, with the spacing Prisma's own
  // tagged template leaves around it.)
  assert.match(sql[0], /lease_token =\s+\?\s*::uuid/);
  assert.match(sql[0], /RETURNING id, lease_token AS "leaseToken"/);
  assert.match(tokens[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(tokens[0], tokens[1], "two claims never share a token");
  assert.deepEqual(first, { id: "src-1", leaseToken: tokens[0] });
  assert.deepEqual(second, { id: "src-2", leaseToken: tokens[1] });
});

test("recovery ends a spent claim, clears its token and its chunks", async () => {
  const db = new LeasedTable();
  db.row.attempts = 1;
  db.row.leaseToken = TOK_A;
  db.row.updatedAt = new Date(Date.now() - 60 * 60 * 1000);
  db.chunks.set("c1", { sourceId: "src-1", text: "hello", embedding: null });

  const service = build(db, { embed: async () => ({ vectors: [], tokens: 0 }) });
  await service.recoverStale();

  assert.equal(db.row.status, "FAILED");
  assert.equal(db.row.leaseToken, null);
  assert.equal(db.row.chunkCount, 0);
  assert.equal(db.chunks.size, 0);
});

test("a vector write that matches no row abandons the attempt", async () => {
  const db = new LeasedTable();
  db.row.leaseToken = TOK_C;
  db.vectorMiss = true;

  const service = build(db, {
    embed: async (input: string[]) => ({
      vectors: input.map(() => new Array(1536).fill(0.5)),
      tokens: 3,
    }),
  });

  await service.index("src-1", TOK_C);

  // The update is source-scoped...
  assert.match(db.sql[0], /AND source_id =\s+\?\s*::uuid/);
  // ...and a miss is ownership loss, not a READY row with an unembedded chunk.
  assert.equal(db.row.status, "PROCESSING");
  assert.equal(db.row.leaseToken, TOK_C);
  assert.ok(db.writes.some((write) => write.startsWith("vector:miss:")));
  assert.equal(db.writes.some((write) => write.includes('"READY"')), false);
  assert.equal(db.writes.some((write) => write.includes('"FAILED"')), false);
});
