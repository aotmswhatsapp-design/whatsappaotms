# AOTMS knowledge files — admission, fidelity, replacement and RAG provenance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing agent-knowledge pipeline safe to expose to every tenant: validate what enters, keep page and table provenance through chunking and retrieval, make replacement non-destructive, and close the reliability and concurrency defects found in the Phase 1 audit — without changing embeddings, dimensions, retrieval tuning, the reply flow or agent routing.

**Architecture:** Five sequential tasks over the existing pipeline (`KnowledgeController` → `KnowledgeService` → `MediaStorage` / `extract` / `OpenAiProvider` → `knowledge_chunks` → `RetrievalService` → `reply.prompt`). All database change is one additive migration. Admission moves into a new pure module `knowledge.file.ts` so it can be tested without a database. Extraction returns typed *blocks* carrying page/sheet/row context, and chunking preserves that context, which finally lets a citation say "page 4" instead of "somewhere in the price list". Replacement writes a second source row and retires the first only inside the transaction that marks the new one READY, so a failed replacement cannot destroy working knowledge.

**Tech Stack:** NestJS 11 (Express), Prisma 6 on Supabase Postgres with pgvector 0.8+, Supabase Storage over REST, OpenAI `text-embedding-3-small` (1536), `pdfjs-dist` 3.11.174, `mammoth` 1.13.0, `exceljs` 4.4.0, Next.js frontend, `node --test` for backend tests.

**Spec:** There is no separate design document. This plan argues from the Phase 1 audit (delivered in conversation) and from decisions **D1–D9** given by the product owner on 2026-11-26. The mapping table under "Scope map" is the requirement trace: every audit defect and every D-decision lands in exactly one task.

## Global Constraints

- Backend runtime `node >= 20.11`; TypeScript `strict` with `noUnusedLocals: true`; `nest build` uses `tsconfig.build.json`, which already excludes `**/*.test.ts`.
- Exactly one migration this cycle: `Backend/prisma/migrations/0022_knowledge_fidelity/migration.sql`. It is **additive only** — new nullable columns, one `NOT NULL DEFAULT`, two indexes. Never touch, rename or regenerate `0021_agent_transfers`.
- Do not run `prisma migrate deploy`, `prisma migrate dev`, or any production migration in this work. `prisma validate` and `prisma generate` are allowed (no database access).
- Embeddings are immutable in this plan: `text-embedding-3-small`, `vector(1536)`, HNSW cosine index, `TOP_K = 6`, `FLOOR = 0.25`. No re-embedding of existing rows.
- No Redis, no BullMQ, no new service. The rows stay the queue; `AgentsRunner` stays the worker.
- Scanned PDFs stay unsupported and must keep returning the existing clear refusal. GIF images, vision description and Whisper transcription keep working.
- Knowledge mutations stay `@Roles("OWNER")`. Read routes stay member-wide (no `@Roles`), which is present behaviour and is not a security defect.
- Storage: bucket from `AGENT_SOURCE_BUCKET` (default `agent-sources`), private; no path, key or bucket name ever reaches the browser; signed URLs last 300 s and are issued only after an ownership check.
- Render build remains `npm ci && npm run build`. No native modules, no LibreOffice, no canvas.
- Tests must not touch a real database, OpenAI or Supabase: every test runs against fakes.
- `AgentRouter`, `ReplyService`'s routing, `0021_agent_transfers` and the agent-to-agent plan are out of bounds. `ReplyService.answer()` may change only where this plan says so (the `retrieval.search` call site).

---

## What already exists (do not rebuild)

| Concern | Where it lives |
|---|---|
| Upload, list, delete, retry routes | `Backend/src/agents/knowledge.controller.ts` |
| Pipeline, claim, index, fail, stale recovery | `Backend/src/agents/knowledge.service.ts` |
| Chunking (3,200 chars, 480 overlap, 5,000 cap) | `Backend/src/agents/knowledge.chunk.ts` |
| Document readers | `Backend/src/agents/extract.ts` |
| Image/audio readers | `Backend/src/agents/extract.media.ts` |
| OpenAI chat, vision, embeddings, Whisper | `Backend/src/agents/ai.openai.ts` |
| Error taxonomy | `Backend/src/agents/ai.errors.ts` |
| Cosine search | `Backend/src/agents/retrieval.service.ts` |
| Prompt assembly | `Backend/src/agents/reply.prompt.ts` |
| Storage REST client | `Backend/src/inbox/media.storage.ts` |
| Worker loop | `Backend/src/agents/agents.runner.ts` |
| UI | `frontend/src/features/ai-assistant/**` |
| Schema | `Backend/prisma/schema.prisma` (`KnowledgeSource`, `KnowledgeChunk`) |

The pipeline already satisfies Phase 4 steps 1–10 and Phase 5's isolation chain. This plan changes *what is admitted*, *what metadata survives*, *how lifecycle transitions are guarded*, and *what the client can see*.

## Scope map — audit defect to task

| ID | Defect (Phase 1 audit) | Task |
|---|---|---|
| B-1 | Storage calls have no timeout; a hung fetch stalls the runner | 1 |
| B-4 | No extension/MIME/signature allowlist; `DOCUMENT_EXTENSIONS` is dead code | 1 |
| B-5 | Client filename tail becomes a storage path segment | 1 |
| B-8 | Deletes are unverified and swallows errors | 1 (client) / 4 (callers, sweep) |
| B-9 | No duplicate detection | 1 |
| B-13 | Retrieval filters `agent_id` but not `workspace_id` | 1 |
| B-6 | PDF page boundaries erased | 2 |
| B-7 | CSV/XLSX empty cells dropped; quoted newlines split rows | 2 |
| B-14 | DOCX headings/tables flattened (from audit §3) | 2 |
| B-3 | Vision/Whisper tokens discarded | 3 |
| B-15 | No image metadata (dimensions) | 3 |
| B-2 | `retry()` has no status guard; two live attempts can interleave | 4 |
| B-10 | One big upload blocks every reply in that process | 4 |
| B-11 | `retry()` leaves stale counters | 4 |
| B-16 | No job timeout; extraction does not renew the lease | 4 |
| B-17 | No orphaned-object sweeper | 4 |
| B-12 | UI note cap 40,000 vs server 400,000; limits copied in four places | 1 + 5 |

D1 → migration numbering. D2 → Task 1. D3 → Task 2. D4 → Task 2 (structure) + Task 3 (`meta`). D5 → constraint, no task. D6 → Task 4. D7 → Task 1. D8 → unchanged. D9 → this document.

---

## Data model — migration `0022_knowledge_fidelity`

### Schema diff

Add to `model KnowledgeSource` (after `indexedAt`):

```prisma
  /// Lowercase hex SHA-256 of the stored bytes. Null for a typed note.
  sha256           String?   @db.Char(64)
  /// Who added it. Mirrors Agent.createdByUserId: a plain column, no relation,
  /// so the row survives the user being deleted.
  uploadedByUserId String?   @map("uploaded_by_user_id") @db.Uuid
  /// The source this one replaces. Plain column: a self-relation would cascade
  /// the successor away when the predecessor is retired.
  replacesSourceId String?   @map("replaces_source_id") @db.Uuid
  /// What the file *is*, not its content: sheet names and header rows for a
  /// workbook, pixel size for an image, page count for a PDF. Validated with
  /// zod on read; never pasted into a prompt.
  meta             Json?
  /// Tokens spent reading images and audio. Kept apart from `embedTokens` so
  /// the Usage screen keeps meaning what it says.
  extractTokens    Int       @default(0) @map("extract_tokens")
```

and, at the bottom of the model:

```prisma
  /// Two identical files for one agent are a double charge and a duplicate
  /// answer. Partial in effect: typed notes have no hash, and NULLs never
  /// collide in Postgres.
  @@unique([agentId, sha256])
  @@index([replacesSourceId])
```

Add to `model KnowledgeChunk` (after `tokens`):

```prisma
  /// 1-based PDF page. Null for sources without pages.
  page    Int?
  /// CSV/XLSX sheet name.
  sheet   String?
  /// First and last data row this chunk covers, header excluded, 1-based.
  rowFrom Int?    @map("row_from")
  rowTo   Int?    @map("row_to")
  /// Nearest preceding heading (DOCX, Markdown).'
  heading String?
```

### `Backend/prisma/migrations/0022_knowledge_fidelity/migration.sql`

```sql
-- Additive only. Existing rows keep NULL in every new column, and
-- `extract_tokens` takes the fast default path (Postgres 11+), so no rewrite.
ALTER TABLE "knowledge_sources"
  ADD COLUMN     "sha256" CHAR(64),
  ADD COLUMN     "uploaded_by_user_id" UUID,
  ADD COLUMN     "replaces_source_id" UUID,
  ADD COLUMN     "meta" JSONB,
  ADD COLUMN     "extract_tokens" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "knowledge_chunks"
  ADD COLUMN "page" INTEGER,
  ADD COLUMN "sheet" TEXT,
  ADD COLUMN "row_from" INTEGER,
  ADD COLUMN "row_to" INTEGER,
  ADD COLUMN "heading" TEXT;

-- Names match what Prisma emits for @@unique / @@index, so `prisma migrate dev`
-- sees no drift. NULLs are distinct, so typed notes never collide.
CREATE UNIQUE INDEX "knowledge_sources_agent_id_sha256_key"
  ON "knowledge_sources" ("agent_id", "sha256");

CREATE INDEX "knowledge_sources_replaces_source_id_idx"
  ON "knowledge_sources" ("replaces_source_id");
```

### `Backend/prisma/migrations/0022_knowledge_fidelity/rollback.sql` (documentation, never auto-run)

```sql
DROP INDEX IF EXISTS "knowledge_sources_replaces_source_id_idx";
DROP INDEX IF EXISTS "knowledge_sources_agent_id_sha256_key";
ALTER TABLE "knowledge_chunks"
  DROP COLUMN IF EXISTS "page",
  DROP COLUMN IF EXISTS "sheet",
  DROP COLUMN IF EXISTS "row_from",
  DROP COLUMN IF EXISTS "row_to",
  DROP COLUMN IF EXISTS "heading";
ALTER TABLE "knowledge_sources"
  DROP COLUMN IF EXISTS "sha256",
  DROP COLUMN IF EXISTS "uploaded_by_user_id",
  DROP COLUMN IF EXISTS "replaces_source_id",
  DROP COLUMN IF EXISTS "meta",
  DROP COLUMN IF EXISTS "extract_tokens";
```

Roll back code first: the previous code ignores every new column, so the API keeps serving while the columns sit unused. Drop the columns only if the release is abandoned.

### Storage path (new uploads only)

```
workspaces/{workspaceId}/agents/{agentId}/knowledge/{sourceId}/original.{ext}
```

`{ext}` comes from the **sniffed** type, never from `file.originalname`. Existing rows keep `agents/{workspaceId}/{agentId}/{uuid}.{ext}` and keep working, because `download` and `remove` read `storagePath` from the row. **Do not move existing objects** — that is a migration of bytes with no benefit and a real risk of orphaning.

---

## API surface

| Method | Path | Change | Guard |
|---|---|---|---|
| GET | `/v1/agents/:id/sources` | + `extractTokens`, `meta`, `replacesSourceId` in `SourceView` | member |
| GET | `/v1/agents/:id/sources/:sourceId/download` | **new** — `{ url, expiresIn }`, 300 s signed | member |
| POST | `/v1/agents/:id/sources/text` | + `uploadedByUserId`, `sha256: null` | OWNER |
| POST | `/v1/agents/:id/sources/file` | extension/MIME pre-filter + signature validation; 409 on duplicate | OWNER |
| PUT | `/v1/agents/:id/sources/:sourceId/file` | **new** — safe replacement, returns the *new* source | OWNER |
| POST | `/v1/agents/:id/sources/:sourceId/retry` | 409 `SOURCE_BUSY` unless FAILED or READY; counters reset | OWNER |
| DELETE | `/v1/agents/:id/sources/:sourceId` | 409 `SOURCE_BUSY` while PROCESSING; verified object delete | OWNER |

Error codes (all `ConflictException` unless noted): `SOURCE_TOO_LARGE` (413-equivalent today: 409, unchanged), `SOURCE_UNSUPPORTED` (415 for the interceptor, `ExtractError` code inside the job), `SOURCE_DUPLICATE`, `SOURCE_UNCHANGED`, `SOURCE_BUSY`, `SOURCE_NOT_FILE`.

---

## Task 1: Admission control, storage hardening, tenant proof

**Files:**
- Create: `Backend/src/agents/knowledge.file.ts`
- Create: `Backend/src/agents/knowledge.file.test.ts`
- Create: `Backend/src/agents/knowledge.service.test.ts`
- Create: `Backend/src/agents/knowledge.tenant.test.ts`
- Create: `Backend/src/agents/testing/fakes.ts`
- Create: `Backend/tsconfig.test.json`
- Modify: `Backend/src/agents/knowledge.service.ts`
- Modify: `Backend/src/agents/knowledge.controller.ts`
- Modify: `Backend/src/agents/retrieval.service.ts` (B-13)
- Modify: `Backend/src/agents/agents.service.ts` (one call site)
- Modify: `Backend/src/agents/reply.service.ts` (one call site)
- Modify: `Backend/src/inbox/media.storage.ts`
- Modify: `Backend/src/agents/extract.ts` (export `DOCUMENT_EXTENSIONS` from its new home; remove the dead copy)
- Modify: `Backend/src/config/env.ts`
- Modify: `Backend/prisma/schema.prisma` + create the migration directory above
- Modify: `Backend/package.json` (test scripts), `Backend/.gitignore` (`.test-dist`)

**Interfaces:**
- Consumes: `MediaStorage` as it exists today (`upload`, `download`, `remove`, `signedUrl`).
- Produces: `inspectUpload(input): InspectedFile`; `sha256Of(bytes): string`; `MediaStorage.remove(paths, { strict? })`; `MediaStorage.list(prefix, { limit?, offset? })`; `KnowledgeService.replace` signature reserved for Task 4; `retrieval.search({ agentId, workspaceId }, question)`.

### Step 1.1: Test runner first

- [ ] Create `Backend/tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./.test-dist",
    "incremental": false,
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", ".test-dist"]
}
```

- [ ] Add to `Backend/package.json` scripts:

```json
    "test": "tsc -p tsconfig.test.json && node --test .test-dist",
    "test:only": "node --test .test-dist"
```

- [ ] Append `.test-dist/` to `Backend/.gitignore`.

- [ ] Run `npm test` and confirm it executes zero tests cleanly (`# tests 0`). Node 20.11 searches a directory argument recursively for `*.test.js`.

### Step 1.2: Failing test — validation module

- [ ] Create `Backend/src/agents/testing/fakes.ts` with the three fakes every later task reuses:

```ts
import type { AuthClaims } from "../../auth/auth.types";

export interface Call { path: string; args: any; ok: boolean }

/** Records every model call and can be told to refuse a specific one. */
export class FakePrisma {
  readonly calls: Call[] = [];
  private failOn = new Set<string>();

  refuse(path: string): void { this.failOn.add(path); }
  allow(path: string): void { this.failOn.delete(path); }

  private async invoke(path: string, args: any, run: () => any) {
    const ok = !this.failOn.has(path);
    this.calls.push({ path, args, ok });
    if (!ok) throw new Error(`${path} refused`);
    return run();
  }

  knowledgeSource = {
    create: (args: any) => this.invoke("knowledgeSource.create", args, () => ({ id: args.data.id ?? "src-1", ...args.data })),
    createMany: (args: any) => this.invoke("knowledgeSource.createMany", args, () => ({ count: args.data.length })),
    findFirst: (args: any) => this.invoke("knowledgeSource.findFirst", args, () => null),
    findUnique: (args: any) => this.invoke("knowledgeSource.findUnique", args, () => null),
    findMany: (args: any) => this.invoke("knowledgeSource.findMany", args, () => []),
    update: (args: any) => this.invoke("knowledgeSource.update", args, () => ({ id: args.where.id, ...args.data })),
    updateMany: (args: any) => this.invoke("knowledgeSource.updateMany", args, () => ({ count: 1 })),
    delete: (args: any) => this.invoke("knowledgeSource.delete", args, () => ({ id: args.where.id })),
    deleteMany: (args: any) => this.invoke("knowledgeSource.deleteMany", args, () => ({ count: 0 })),
  };

  knowledgeChunk = {
    deleteMany: (args: any) => this.invoke("knowledgeChunk.deleteMany", args, () => ({ count: 0 })),
    createMany: (args: any) => this.invoke("knowledgeChunk.createMany", args, () => ({ count: args.data.length })),
    findMany: (args: any) => this.invoke("knowledgeChunk.findMany", args, () => []),
  };

  agent = {
    findFirst: (args: any) => this.invoke("agent.findFirst", args, () => ({ id: args.where.id, workspaceId: args.where.workspaceId })),
    findUniqueOrThrow: (args: any) => this.invoke("agent.findUniqueOrThrow", args, () => ({ id: args.where.id })),
  };

  $executeRaw = (...args: any[]) => this.invoke("$executeRaw", args, () => 1);
  $executeRawUnsafe = (...args: any[]) => this.invoke("$executeRawUnsafe", args, () => 1);
  $queryRaw = (...args: any[]) => this.invoke("$queryRaw", args, () => []);
  $transaction = async (input: any) =>
    Array.isArray(input) ? Promise.all(input) : input(this);
}

/** Records bytes by path; `failRemove` proves the strict path throws. */
export class FakeStorage {
  readonly uploaded: { path: string; bytes: Buffer; mime: string }[] = [];
  readonly removed: string[][] = [];
  failRemove = false;
  failUpload = false;

  async upload(path: string, bytes: Buffer, mime: string) {
    if (this.failUpload) throw new Error("storage refused the upload");
    this.uploaded.push({ path, bytes, mime });
  }
  async download() { return Buffer.from("hello"); }
  async signedUrl(path: string) { return `https://signed.test/${path}`; }
  async remove(paths: string[], options: { strict?: boolean } = {}) {
    if (this.failRemove && options.strict) throw new Error("storage refused the delete");
    this.removed.push(paths);
  }
  async list() { return []; }
  get configured() { return true; }
}

export class FakeProvider {
  embedTokens = 7;
  async embed(input: string[]) {
    return { vectors: input.map(() => new Array(1536).fill(0.01)), tokens: this.embedTokens };
  }
  async chat() { return { text: "ok", tokensIn: 1, tokensOut: 1 }; }
  get configured() { return true; }
}

export class FakeWorkspaces {
  constructor(readonly workspaceId = "ws-a", readonly userId = "user-a") {}
  async primaryFor(_claims: AuthClaims) {
    return { workspaceId: this.workspaceId, userId: this.userId, role: "OWNER" as const };
  }
}

export const CLAIMS: AuthClaims = { id: "user-a", email: "a@example.test" } as AuthClaims;
```

- [ ] Create `Backend/src/agents/knowledge.file.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { ExtractError } from "./ai.errors";
import { inspectUpload, sha256Of } from "./knowledge.file";

const LIMIT = 25 * 1024 * 1024;
const pdf = (body = "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF") => Buffer.from(body);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const gif = Buffer.from("GIF89a        ", "latin1");
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

const inspect = (name: string, declaredMime: string, bytes: Buffer) =>
  inspectUpload({ name, declaredMime, bytes, limit: LIMIT });

test("a PDF is accepted as a document, whatever the browser called it", () => {
  const got = inspect("prices.pdf", "application/octet-stream", pdf());
  assert.equal(got.kind, "document");
  assert.equal(got.mime, "application/pdf");
  assert.equal(got.extension, "pdf");
});

test("the declared MIME is replaced by the sniffed one", () => {
  const got = inspect("menu.png", "image/jpeg", png);
  assert.equal(got.mime, "image/png");
  assert.equal(got.extension, "png");
});

test("docx and xlsx are both zips and are told apart by extension", () => {
  assert.equal(inspect("policy.docx", "", zip).kind, "document");
  assert.equal(inspect("rates.xlsx", "", zip).kind, "document");
});

test("a renamed archive is refused before anything is stored", () => {
  assert.throws(() => inspect("prices.pdf", "application/pdf", zip), /could not be read|not one/);
});

test("a binary renamed .txt is refused", () => {
  const bytes = Buffer.concat([Buffer.from("hello"), Buffer.from([0])]);
  assert.throws(() => inspect("notes.txt", "text/plain", bytes), ExtractError);
});

test("gif is an image, not a document", () => {
  const got = inspect("menu.gif", "image/gif", gif);
  assert.equal(got.kind, "image");
  assert.equal(got.mime, "image/gif");
});

test("an unknown extension is refused with a sentence naming a real format", () => {
  assert.throws(() => inspect("archive.zip", "application/zip", zip), /Upload a PDF/);
});

test("an oversized buffer is refused before it is hashed", () => {
  assert.throws(() => inspect("big.pdf", "application/pdf", pdf()), /25 MB/);
});

test("the hash is stable lowercase hex", () => {
  assert.equal(sha256Of(Buffer.from("a")), "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
});

test("a title is trimmed and capped without touching the extension", () => {
  const got = inspect(`${"x".repeat(300)}.pdf`, "", pdf());
  assert.equal(got.title.length, 160);
  assert.ok(got.title.endsWith(".pdf"));
});
```

- [ ] Run `npm test`; expect `node:assert` to fail because `knowledge.file.ts` does not exist. This is the failing gate.

### Step 1.3: Implement `knowledge.file.ts`

- [ ] Create `Backend/src/agents/knowledge.file.ts`:

```ts
import { createHash } from "node:crypto";

import { ExtractError } from "./ai.errors";

/** The same ceiling the inbox uses for what leaves, applied to what arrives. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Every format with a verified reader in `extract.ts` or `extract.media.ts`. */
export const DOCUMENT_EXTENSIONS = ["pdf", "docx", "txt", "md", "csv", "xlsx"] as const;
export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"] as const;
export const AUDIO_EXTENSIONS = ["mp3", "m4a", "ogg", "oga", "wav", "flac", "opus", "webm"] as const;

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  opus: "audio/ogg",
  webm: "audio/webm",
};

export type FileKind = "document" | "image" | "audio";

export interface InspectedFile {
  kind: FileKind;
  mime: string;
  extension: string;
  title: string;
  sha256: string;
}

export function extensionOf(name: string): string {
  const at = name.lastIndexOf(".");
  return at >= 0 ? name.slice(at + 1).toLowerCase() : "";
}

export function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * What an upload must prove before it costs a bucket object and a queue slot.
 *
 * The declared MIME is never trusted: a browser that cannot name a type says
 * `application/octet-stream`, and a client that wants to smuggle a `.zip` will
 * say `application/pdf`. The bytes decide, the extension says which of that
 * family's readers to use, and the two must agree.
 */
export function inspectUpload(input: {
  name: string;
  declaredMime: string;
  bytes: Buffer;
  limit?: number;
}): InspectedFile {
  const limit = input.limit ?? MAX_SOURCE_BYTES;
  const extension = extensionOf(input.name);
  const kind = kindOf(extension);

  if (!kind) {
    throw new ExtractError(
      "SOURCE_UNSUPPORTED",
      `A ${extension ? `.${extension}` : "file of that type"} cannot be read. Upload a PDF, DOCX, TXT, CSV, XLSX, an image, or a voice note.`,
    );
  }

  if (input.bytes.length === 0) {
    throw new ExtractError("SOURCE_EMPTY", "That file arrived empty.");
  }

  if (input.bytes.length > limit) {
    throw new ExtractError(
      "SOURCE_TOO_LARGE",
      `Training files are limited to ${Math.round(limit / (1024 * 1024))} MB.`,
    );
  }

  const sniffed = sniff(input.bytes);

  if (!agrees(extension, sniffed)) {
    throw new ExtractError(
      "SOURCE_UNSUPPORTED",
      "That file could not be read. It may be corrupt, password-protected, or not really the format its name says.",
    );
  }

  return {
    kind,
    mime: MIME[extension] ?? input.declaredMime,
    extension: extension === "jpeg" ? "jpg" : extension,
    title: input.name.trim().slice(0, 160) || "Untitled file",
    // Hashing 25 MB is cheap and happens once, before the bytes are stored.
    sha256: sha256Of(input.bytes),
  };
}

function kindOf(extension: string): FileKind | null {
  if ((DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) return "document";
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(extension)) return "image";
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(extension)) return "audio";
  return null;
}

type Sniffed = "pdf" | "zip" | "jpeg" | "png" | "webp" | "gif" | "mp3" | "m4a" | "ogg" | "wav" | "flac" | "text" | "binary";

function sniff(bytes: Buffer): Sniffed {
  if (bytes.length >= 5 && bytes.toString("latin1", 0, 5) === "%PDF-") return "pdf";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "zip";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (bytes.length >= 12 && bytes.toString("latin1", 8, 12) === "WAVE") return "wav";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString("latin1", 0, 6))) return "gif";
  if (bytes.length >= 4 && bytes.toString("latin1", 0, 4) === "fLaC") return "flac";
  if (bytes.length >= 4 && bytes.toString("latin1", 0, 4) === "OggS") return "ogg";
  if (bytes.length >= 3 && bytes.toString("latin1", 0, 3) === "ID3") return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  if (bytes.length >= 12 && bytes.toString("latin1", 4, 8) === "ftyp") return "m4a";

  // Text has no magic. A NUL byte in the first 8 KiB, or a decode that is
  // mostly replacement characters, is the cheapest reliable tell.
  const head = bytes.subarray(0, 8192);
  if (!head.includes(0)) {
    const decoded = head.toString("utf8");
    const bad = (decoded.match(/\uFFFD/g) ?? []).length;
    if (bad <= decoded.length * 0.02) return "text";
  }

  return "binary";
}

function agrees(extension: string, sniffed: Sniffed): boolean {
  const family = kindOf(extension);

  if (family === "document") {
    if (extension === "pdf") return sniffed === "pdf";
    if (extension === "docx" || extension === "xlsx") return sniffed === "zip";
    return sniffed === "text"; // txt, md, csv
  }

  if (family === "image") {
    if (extension === "jpg" || extension === "jpeg") return sniffed === "jpeg";
    if (extension === "png") return sniffed === "png";
    if (extension === "webp") return sniffed === "webp";
    return sniffed === "gif";
  }

  if (family === "audio") {
    if (extension === "mp3") return sniffed === "mp3";
    if (extension === "m4a") return sniffed === "m4a";
    if (extension === "wav") return sniffed === "wav";
    if (extension === "flac") return sniffed === "flac";
    return sniffed === "ogg"; // ogg, oga, opus, webm
  }

  return false;
}
```

- [ ] Delete `DOCUMENT_EXTENSIONS` and `extensionOf` from `Backend/src/agents/extract.ts`, and import them from `knowledge.file.ts` instead (two imports: `extract.ts` uses `extensionOf` internally, `knowledge.service.ts` uses the rest). Keep the exported name identical so nothing else changes.
- [ ] Run `npm test`; the validation suite passes.

### Step 1.4: Storage client — timeouts, strict delete, listing

- [ ] In `Backend/src/inbox/media.storage.ts`:

```ts
const TIMEOUT_MS = 30_000;          // metadata calls
const TRANSFER_TIMEOUT_MS = 120_000; // up to 25 MB each way
```

- [ ] Add `signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS)` to the `fetch` in `upload` and in `download`; `TIMEOUT_MS` to `signedUrl`, to `remove` and to `ensureBucket`. A request that never answers now rejects instead of parking the runner for ever (B-1).
- [ ] Replace `remove` with:

```ts
/**
 * Best effort unless a caller says otherwise.
 *
 * The inbox and templates delete as a side effect of something the user already
 * asked for, so a storage hiccup must not fail their request. Knowledge deletes
 * pass `strict`, because a silent failure there is an object nobody can name
 * again.
 */
async remove(paths: string[], options: { strict?: boolean } = {}): Promise<void> {
  if (paths.length === 0 || !this.configured) {
    if (options.strict) throw new ServiceUnavailableException("Media storage is not configured on this server.");
    return;
  }

  const { base } = this.required();

  const response = await fetch(`${base}/storage/v1/object/${this.bucket}`, {
    method: "DELETE",
    headers: { ...this.headers(), "content-type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((error: unknown) => {
    this.logger.warn(`Could not delete ${paths.length} object(s): ${error instanceof Error ? error.message : "unknown"}`);
    return null;
  });

  if (response && !response.ok) {
    const detail = `storage answered ${response.status}`;
    if (options.strict) throw new ServiceUnavailableException(`Could not delete the stored file (${detail}).`);
    this.logger.warn(`Could not delete ${paths.length} object(s): ${detail}`);
  }
}
```

- [ ] Add listing, for the orphan sweeper in Task 4:

```ts
/**
 * One page of a prefix. Supabase returns `{ name }` entries; `updated_at` is
 * present on real objects and null on folder rows, which the sweeper skips.
 */
async list(prefix: string, options: { limit?: number; offset?: number } = {}): Promise<
  { name: string; updatedAt: string | null }[]
> {
  const { base } = this.required();

  const response = await fetch(`${base}/storage/v1/object/list/${this.bucket}`, {
    method: "POST",
    headers: { ...this.headers(), "content-type": "application/json" },
    body: JSON.stringify({
      prefix,
      limit: options.limit ?? 100,
      offset: options.offset ?? 0,
      sortBy: { column: "name", order: "asc" },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new ServiceUnavailableException(`Could not list stored files (storage answered ${response.status}).`);
  }

  const rows = (await response.json().catch(() => [])) as { name?: string; updated_at?: string | null }[];

  return rows
    .filter((row): row is { name: string; updated_at?: string | null } => Boolean(row.name))
    .map((row) => ({ name: row.name, updatedAt: row.updated_at ?? null }));
}
```

- [ ] Confirm `signedUrl` is unchanged in shape; `TEXT` sources never call it.

### Step 1.5: `addFile` — validate, hash, dedupe, new path

- [ ] In `Backend/src/agents/knowledge.service.ts`, replace the body of `addFile` (and keep the signature):

```ts
async addFile(claims: AuthClaims, agentId: string, file: UploadedMedia): Promise<{ source: SourceView }> {
  const { workspaceId, userId } = await this.workspaces.primaryFor(claims);
  const agent = await this.agentOf(workspaceId, agentId);

  const inspected = inspectUpload({
    name: file.originalname,
    declaredMime: file.mimetype ?? "",
    bytes: file.buffer,
    limit: this.maxBytes,
  });

  const id = randomUUID();

  return this.store({
    agentId: agent.id,
    workspaceId,
    userId,
    id,
    inspected,
    bytes: file.buffer,
    replacesSourceId: null,
  });
}

/**
 * Bytes first, row second, and the object removed if the row cannot be written:
 * an object with no row is garbage, and a row without an object is a retry that
 * can never succeed.
 *
 * Shared with `replace`, which is the same operation with one extra column.
 */
private async store(input: {
  agentId: string;
  workspaceId: string;
  userId: string;
  id: string;
  inspected: InspectedFile;
  bytes: Buffer;
  replacesSourceId: string | null;
}): Promise<{ source: SourceView }> {
  const duplicate = await this.prisma.knowledgeSource.findFirst({
    where: {
      agentId: input.agentId,
      sha256: input.inspected.sha256,
      id: input.replacesSourceId ? { not: input.replacesSourceId } : undefined,
    },
    select: { id: true, title: true },
  });

  if (duplicate) {
    throw new ConflictException({
      code: "SOURCE_DUPLICATE",
      message: `That file is already attached as “${duplicate.title}”. Delete it there before uploading it again.`,
    });
  }

  const path = `workspaces/${input.workspaceId}/agents/${input.agentId}/knowledge/${input.id}/original.${input.inspected.extension}`;

  await this.storage.upload(path, input.bytes, input.inspected.mime);

  try {
    const row = await this.prisma.knowledgeSource.create({
      data: {
        id: input.id,
        agentId: input.agentId,
        kind: "FILE",
        title: input.inspected.title,
        mime: input.inspected.mime,
        size: input.bytes.length,
        storagePath: path,
        sha256: input.inspected.sha256,
        uploadedByUserId: input.userId,
        replacesSourceId: input.replacesSourceId,
        status: "PENDING",
      },
    });

    return { source: sourceView(row) };
  } catch (error) {
    await this.storage.remove([path]);
    // The unique index is the race backstop: two identical uploads at once.
    if (isUniqueViolation(error)) {
      throw new ConflictException({
        code: "SOURCE_DUPLICATE",
        message: "That file is already attached to this agent.",
      });
    }
    throw error;
  }
}
```

- [ ] Add the two small helpers at the bottom of the file:

```ts
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}
```

- [ ] Add `maxBytes` to the constructor and `private readonly maxBytes: number;`:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly storage: MediaStorage,
    private readonly provider: OpenAiProvider,
    private readonly media: OpenAiMediaExtractor,
    private readonly config: ConfigService,
  ) {
    // The interceptor cannot read configuration (decorators run before DI), so
    // 25 MB is its hard ceiling and this may only lower it.
    this.maxBytes = Math.min(config.get<number>("KNOWLEDGE_MAX_BYTES") ?? MAX_SOURCE_BYTES, MAX_SOURCE_BYTES);
  }
```

- [ ] In `Backend/src/config/env.ts`, beside `AGENT_SOURCE_BUCKET`:

```ts
  /**
   * The largest training file, in bytes. The multipart interceptor enforces a
   * hard 25 MB ceiling that no setting can raise; this can only lower it.
   */
  KNOWLEDGE_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
```

- [ ] Remove the old `MAX_SOURCE_BYTES` definition from `knowledge.service.ts` and re-export it: `export { MAX_SOURCE_BYTES } from "./knowledge.file";` — the controller import keeps working.
- [ ] `addText` gains the actor: `uploadedByUserId: userId` (destructure `userId` from `primaryFor`).

### Step 1.6: Controller — pre-filter and unchanged routes

- [ ] In `Backend/src/agents/knowledge.controller.ts`, add a cheap pre-filter that fails before Multer buffers a 25 MB body. The service still validates signatures; this only saves the round trip.

```ts
import { UnsupportedMediaTypeException } from "@nestjs/common";
import { DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, AUDIO_EXTENSIONS, extensionOf } from "./knowledge.file";

const ALLOWED = new Set<string>([...DOCUMENT_EXTENSIONS, ...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS]);

const acceptUpload = (
  _request: unknown,
  file: { originalname: string },
  done: (error: Error | null, accept?: boolean) => void,
) => {
  if (ALLOWED.has(extensionOf(file.originalname))) return done(null, true);

  // A non-MulterError passes through Nest's interceptor untouched when it is an
  // HttpException, so the client sees 415 rather than 500.
  done(new UnsupportedMediaTypeException("That file type cannot be read. Upload a PDF, DOCX, TXT, CSV, XLSX, an image, or a voice note."));
};
```

and pass it: `FileInterceptor("file", { limits: { fileSize: MAX_SOURCE_BYTES }, fileFilter: acceptUpload })`.

- [ ] Add the download route now (it needs nothing from later tasks):

```ts
  /** GET .../download — a short-lived link, issued only after an ownership check. */
  @Get(":sourceId/download")
  download(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("sourceId", ParseUUIDPipe) sourceId: string,
  ) {
    return this.knowledge.downloadLink(claims, id, sourceId);
  }
```

There is no `GET …/sources/:sourceId`: the list response already carries every field a single row would, and a route nobody calls is surface to keep alive for no one.

- [ ] Add to `KnowledgeService`:

```ts
/**
 * The bytes are never proxied: a 300-second link is cheaper, and it keeps the
 * service key out of every response. A TEXT note has nothing to download.
 */
async downloadLink(claims: AuthClaims, agentId: string, sourceId: string) {
  const { workspaceId } = await this.workspaces.primaryFor(claims);
  const agent = await this.agentOf(workspaceId, agentId);
  const source = await this.sourceOf(agent.id, sourceId);

  if (source.kind !== "FILE" || !source.storagePath) {
    throw new ConflictException({ code: "SOURCE_NOT_FILE", message: "A typed note has no file to download." });
  }

  return { url: await this.storage.signedUrl(source.storagePath), expiresIn: 300 };
}
```

- [ ] `sourceOf` must now also select `kind` and `storagePath` (it already does) — confirm the `select` includes `id, kind, storagePath`.
- [ ] `sourceView` gains `extractTokens`, `meta`, `replacesSourceId`:

```ts
    extractTokens: row.extractTokens ?? 0,
    meta: (row.meta ?? null) as SourceView["meta"],
    replacesSourceId: row.replacesSourceId ?? null,
```

with, above it:

```ts
export interface SourceMeta {
  kind: "table";
  sheets: { name: string; headers: string[]; rowCount: number }[];
}
```

declared as `meta: SourceMeta | null` in `SourceView`, and `KnowledgeSource.meta` / `extractTokens` / `replacesSourceId` added to the row type.

> Task 3 adds `{ kind: "image" }` and `{ kind: "document" }` to `SourceMeta`; the union is opened there, not here, so Task 1 has nothing speculative in it.

### Step 1.7: Retrieval — filter by workspace as well as agent (B-13)

- [ ] Change the signature in `Backend/src/agents/retrieval.service.ts`:

```ts
  async search(
    scope: { agentId: string; workspaceId: string },
    question: string,
  ): Promise<{ chunks: ContextChunk[]; embedTokens: number }> {
```

and the query:

```sql
        SELECT c.id, c.text, s.id AS source_id, s.title,
               c.page, c.sheet, c.row_from, c.row_to, c.heading,
               1 - (c.embedding <=> ${vector}::vector) AS score
        FROM knowledge_chunks c
        JOIN knowledge_sources s ON s.id = c.source_id
        JOIN agents a ON a.id = s.agent_id
        WHERE s.agent_id = ${scope.agentId}::uuid
          AND a.workspace_id = ${scope.workspaceId}::uuid
          AND s.status = 'READY'
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> ${vector}::vector
        LIMIT ${TOP_K}
```

- [ ] Update both call sites in the same commit:
  - `Backend/src/agents/reply.service.ts`: `this.retrieval.search({ agentId: agent.id, workspaceId: conversation.workspaceId }, question)`
  - `Backend/src/agents/agents.service.ts`: `this.retrieval.search({ agentId: agent.id, workspaceId }, dto.question)`
- [ ] `ContextChunk` gains `page: number | null`, `sheet: string | null`, `rowFrom: number | null`, `rowTo: number | null`, `heading: string | null`, mapped from the row (`row.page` etc.).

Do not change `TOP_K`, `FLOOR`, the `SET LOCAL`, the order by, or the model.

### Step 1.8: The tenant suite

- [ ] Create `Backend/src/agents/knowledge.tenant.test.ts`. Every case constructs the service with `FakePrisma`, `FakeStorage`, `FakeProvider` and a `FakeWorkspaces` that answers for `ws-a` only, and asserts a **404 with no storage call and no row mutation** for a foreign id:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { ConflictException, NotFoundException } from "@nestjs/common";

import { KnowledgeService } from "./knowledge.service";
import { CLAIMS, FakePrisma, FakeProvider, FakeStorage, FakeWorkspaces } from "./testing/fakes";

const build = (workspaceId = "ws-a") => {
  const prisma = new FakePrisma();
  const storage = new FakeStorage();
  const service = new KnowledgeService(prisma as any, new FakeWorkspaces(workspaceId) as any, storage as any, new FakeProvider() as any, {} as any, { get: () => undefined } as any);
  return { prisma, storage, service };
};

test("a source id from another workspace is a 404, and nothing is deleted", async () => {
  const { prisma, storage, service } = build();
  // agentOf() answers for ws-a only; the fake's agent.findFirst returns null
  // when the caller's workspace does not own the agent.
  (prisma.agent as any).findFirst = async () => null;

  await assert.rejects(() => service.remove(CLAIMS, "agent-b", "source-b"), NotFoundException);
  assert.equal(prisma.calls.filter((call) => call.path === "knowledgeSource.delete").length, 0);
  assert.equal(storage.removed.length, 0);
});

test("a forged workspaceId in the payload is never read", () => {
  // The service methods take no workspaceId parameter at all: this test documents
  // that the claim is resolved from the token and the body cannot override it.
  const { service } = build();
  const arity = service.addFile.length;
  assert.equal(arity, 3);
});

test("a download link is refused for another tenant before a URL is signed", async () => {
  const { prisma, storage, service } = build();
  let signed = 0;
  (storage as any).signedUrl = async () => { signed += 1; return "https://signed.test/x"; };
  (prisma.agent as any).findFirst = async () => null;

  await assert.rejects(() => service.downloadLink(CLAIMS, "agent-b", "source-b"), NotFoundException);
  assert.equal(signed, 0);
});

test("retry of another tenant's source is refused", async () => {
  const { prisma, service } = build();
  (prisma.agent as any).findFirst = async () => null;

  await assert.rejects(() => service.retry(CLAIMS, "agent-b", "source-b"), NotFoundException);
  assert.equal(prisma.calls.filter((call) => call.path === "knowledgeSource.updateMany").length, 0);
});
```

- [ ] Create `Backend/src/agents/knowledge.service.test.ts` with the admission cases:

```ts
test("a valid PDF is stored under the workspace-scoped path, with its hash", async () => {
  const { prisma, storage, service } = build();
  const created: any[] = [];
  (prisma.knowledgeSource as any).create = async ({ data }: any) => { created.push(data); return data; };

  const { source } = await service.addFile(CLAIMS, "agent-1", {
    buffer: Buffer.from("%PDF-1.7\n"), originalname: "prices.pdf", mimetype: "application/pdf", size: 9,
  } as any);

  assert.match(created[0].storagePath, /^workspaces\/ws-a\/agents\/agent-1\/knowledge\/[0-9a-f-]{36}\/original\.pdf$/);
  assert.equal(created[0].sha256.length, 64);
  assert.equal(created[0].uploadedByUserId, "user-a");
  assert.equal(created[0].mime, "application/pdf");
  assert.equal(source.status, "PENDING");
});

test("an unsupported file never reaches storage", async () => {
  const { storage, service } = build();
  await assert.rejects(() => service.addFile(CLAIMS, "agent-1", {
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]), originalname: "backup.zip", mimetype: "application/zip", size: 4,
  } as any), /Upload a PDF/);
  assert.equal(storage.uploaded.length, 0);
});

test("an exact duplicate is a 409 and stores nothing", async () => {
  const { prisma, storage, service } = build();
  (prisma.knowledgeSource as any).findFirst = async () => ({ id: "old", title: "prices.pdf" });

  await assert.rejects(() => service.addFile(CLAIMS, "agent-1", PDF), (error: any) =>
    error instanceof ConflictException && error.getResponse().code === "SOURCE_DUPLICATE",
  );
  assert.equal(storage.uploaded.length, 0);
});

test("a race that slips past the lookup is still a 409, and the object is removed", async () => {
  const { prisma, storage, service } = build();
  (prisma.knowledgeSource as any).create = async () => { throw Object.assign(new Error("unique"), { code: "P2002" }); };

  await assert.rejects(() => service.addFile(CLAIMS, "agent-1", PDF), ConflictException);
  assert.equal(storage.removed.length, 1);
});
```

- [ ] Add a capture test for the SQL (B-13):

```ts
test("retrieval is scoped by workspace as well as agent", async () => {
  const captured: string[] = [];
  const prisma = {
    $executeRawUnsafe: async () => 1,
    $queryRaw: (strings: TemplateStringsArray) => { captured.push(strings.join(" ? ")); return []; },
    $transaction: async (input: any[]) => Promise.all(input),
  };
  const service = new RetrievalService(prisma as any, new FakeProvider() as any);

  await service.search({ agentId: "agent-1", workspaceId: "ws-a" }, "how much is delivery?");

  const sql = captured.join(" ");
  assert.match(sql, /s\.agent_id/);
  assert.match(sql, /a\.workspace_id/);
  assert.match(sql, /s\.status = 'READY'/);
});
```

### Step 1.9: Gate 1

- [ ] `npx prisma generate` (no database contact).
- [ ] `npx prisma validate`.
- [ ] `npm run typecheck`.
- [ ] `npm test` — all green.
- [ ] `npm run build`.
- [ ] `git diff --stat` — and confirm `Backend/prisma/migrations/0021_agent_transfers/**` is untouched.

**Rollback:** revert the commit. The migration may stay applied: old code ignores every added column, and the indexes are harmless. Nothing in Task 1 deletes user data.

---

## Task 2: Extraction fidelity and chunk provenance

**Files:**
- Modify: `Backend/src/agents/extract.ts`
- Modify: `Backend/src/agents/knowledge.chunk.ts`
- Modify: `Backend/src/agents/knowledge.service.ts` (`loadForIndex`, `readSource`, `index`)
- Modify: `Backend/src/agents/reply.prompt.ts` (`contextBlock` label)
- Modify: `Backend/src/agents/agents.service.ts` (citations)
- Create: `Backend/src/agents/extract.test.ts`
- Create: `Backend/src/agents/knowledge.chunk.test.ts`
- Create: `Backend/src/agents/reply.prompt.test.ts`

**Interfaces:**
- Consumes: `DOCUMENT_EXTENSIONS`, `extensionOf` from Task 1; `MAX_CHUNKS`, `estimateTokens`, `splitText` as they exist.
- Produces: `extractSource(file): Promise<Extracted>`; `chunkBlocks(blocks): ChunkDraft[]`; `ContextChunk.page/sheet/rowFrom/rowTo/heading`; `contextBlock` exported for tests.

**Why blocks and not a string:** page numbers survive only if the text is carried with them. A single `pages.join("\n\n")` erases the only evidence of where an answer came from, so a citation can never name a page and a chunk that straddles two pages can never be attributed. Blocks carry the context; chunking spends it; the prompt prints it.

### Step 2.1: Failing tests — blocks

- [ ] Create `Backend/src/agents/extract.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import * as ExcelJS from "exceljs";

import { ExtractError } from "./ai.errors";
import { csvBlocks, docxHtmlToBlocks, extractSource, pagesToBlocks, parseCsv } from "./extract";

test("each PDF page is its own block, numbered from one", () => {
  assert.deepEqual(pagesToBlocks(["first", "", "third"]), [
    { text: "first", page: 1 },
    { text: "third", page: 3 },
  ]);
});

test("a quoted comma and a quoted newline stay inside one cell", () => {
  const rows = parseCsv('name,address\n"Doe, J","12 Main\nPune"\n');
  assert.deepEqual(rows, [["name", "address"], ["Doe, J", "12 Main\nPune"]]);
});

test("empty cells keep their column", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,,3\n"), [["a", "b", "c"], ["1", "", "3"]]);
});

test("every CSV block repeats the headers and reports its own row range", () => {
  const rows = [["item", "price"]];
  for (let index = 1; index <= 45; index += 1) rows.push([`item ${index}`, String(index * 10)]);

  const { blocks, meta } = csvBlocks(rows);

  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((block) => [block.rowFrom, block.rowTo]), [[1, 20], [21, 40], [41, 45]]);
  assert.ok(blocks.every((block) => block.text.startsWith("Columns: item | price")));
  assert.ok(blocks[0].text.includes("item 1 | 10"));
  assert.deepEqual(meta, { kind: "table", sheets: [{ name: "CSV", headers: ["item", "price"], rowCount: 45 }] });
});

test("a work out sheet keeps its name, headers and empty columns", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Wholesale");
  sheet.addRow(["item", "", "price"]);
  sheet.addRow(["rice", "", "449"]);
  const bytes = Buffer.from(await book.xlsx.writeBuffer());

  const { blocks, meta } = await extractSource({ bytes, mime: "text/csv", name: "rates.xlsx" });

  assert.equal(blocks[0].sheet, "Wholesale");
  assert.ok(blocks[0].text.includes("Columns: item |  | price"));
  assert.ok(blocks[0].text.includes("rice |  | 449"));
  assert.equal(meta?.kind, "table");
});

test("a docx heading attaches to the paragraph beneath it", () => {
  const html = "<h2>Delivery</h2><p>Pune in 24 hours.</p><p>Elsewhere 2-3 days.</p>";
  const blocks = docxHtmlToBlocks(html);

  assert.deepEqual(blocks[0], { text: "Delivery", heading: "Delivery" });
  assert.equal(blocks[1].text, "Pune in 24 hours.");
  assert.equal(blocks[1].heading, "Delivery");
});

test("a docx table becomes one line per row, cells separated", () => {
  const html = "<table><tr><td>item</td><td>price</td></tr><tr><td>rice</td><td>449</td></tr></table>";
  const blocks = docxHtmlToBlocks(html);

  assert.deepEqual(blocks.map((block) => block.text), ["item | price", "rice | 449"]);
});

test("an empty text file is a refusal, not an empty index", async () => {
  await assert.rejects(
    () => extractSource({ bytes: Buffer.from("  \n "), mime: "text/plain", name: "notes.txt" }),
    (error: unknown) => error instanceof ExtractError && error.code === "SOURCE_EMPTY",
  );
});
```

- [ ] Create `Backend/src/agents/knowledge.chunk.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { CHUNK_CHARS, chunkBlocks } from "./knowledge.chunk";

test("two small pages are never merged into one chunk", () => {
  const chunks = chunkBlocks([{ text: "alpha", page: 1 }, { text: "beta", page: 2 }]);

  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map((chunk) => chunk.page), [1, 2]);
});

test("a long page splits, and every piece keeps the page number", () => {
  const chunks = chunkBlocks([{ text: "x".repeat(CHUNK_CHARS * 2), page: 7 }]);

  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.page === 7));
});

test("prose without pages packs together up to the cap", () => {
  const chunks = chunkBlocks([{ text: "a".repeat(2_000) }, { text: "b".repeat(2_000) }]);

  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].text.length <= CHUNK_CHARS);
});

test("table blocks are one chunk each, with their own row range", () => {
  const chunks = chunkBlocks([
    { text: "Columns: a\n1", sheet: "CSV", rowFrom: 1, rowTo: 1 },
    { text: "Columns: a\n2", sheet: "CSV", rowFrom: 2, rowTo: 2 },
  ]);

  assert.deepEqual(chunks.map((chunk) => [chunk.rowFrom, chunk.rowTo]), [[1, 1], [2, 2]]);
});

test("a heading starts a new chunk so it is not buried mid-chunk", () => {
  const chunks = chunkBlocks([
    { text: "Intro", heading: "Welcome" },
    { text: "Terms", heading: "Rules" },
  ]);

  assert.deepEqual(chunks.map((chunk) => chunk.heading), ["Welcome", "Rules"]);
});
```

- [ ] Create `Backend/src/agents/reply.prompt.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { contextBlock } from "./reply.prompt";
import type { ContextChunk } from "./retrieval.service";

const chunk = (over: Partial<ContextChunk>): ContextChunk => ({
  id: "c", text: "body", sourceId: "s", title: "Price list", score: 0.9,
  page: null, sheet: null, rowFrom: null, rowTo: null, heading: null, ...over,
});

test("a page is named in the citation label", () => {
  assert.ok(contextBlock([chunk({ page: 4 })]).includes("[Price list · page 4]"));
});

test("a sheet and its row range are named", () => {
  const label = contextBlock([chunk({ sheet: "Wholesale", rowFrom: 12, rowTo: 24 })]);
  assert.ok(label.includes('[Price list · sheet "Wholesale" rows 12–24]'));
});

test("a plain chunk keeps the bare title", () => {
  assert.ok(contextBlock([chunk({})]).includes("[Price list]"));
});
```

- [ ] Run `npm test`; the three new files fail to compile. That is the gate.

### Step 2.2: Extraction returns blocks

- [ ] In `Backend/src/agents/extract.ts`, add the types and the block builders:

```ts
export interface SourceBlock {
  text: string;
  page?: number;
  sheet?: string;
  rowFrom?: number;
  rowTo?: number;
  heading?: string;
}

export interface TableMeta {
  kind: "table";
  sheets: { name: string; headers: string[]; rowCount: number }[];
}

export interface Extracted {
  blocks: SourceBlock[];
  meta: TableMeta | null;
  /** Tokens spent reading an image or a voice note; 0 for documents. */
  extractTokens: number;
}

/** 20 rows per block: enough to be a paragraph of meaning, small enough that
 *  a retrieved chunk is still one answer's worth of rows. */
const ROWS_PER_BLOCK = 20;

export function pagesToBlocks(pages: string[]): SourceBlock[] {
  return pages.flatMap((text, index) => (text.length > 0 ? [{ text, page: index + 1 }] : []));
}

/** A state machine over the whole text: a comma inside quotes is data, and a
 *  newline inside quotes is still the same cell. */
export function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let at = 0; at < raw.length; at += 1) {
    const char = raw[at];

    if (quoted) {
      if (char === '"') {
        if (raw[at + 1] === '"') { cell += '"'; at += 1; }
        else quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(cell.trim()); cell = ""; continue; }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && raw[at + 1] === "\n") at += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) { row.push(cell.trim()); rows.push(row); }

  return rows.filter((line) => line.some((value) => value.length > 0));
}

/** One block per run of rows, headers repeated, row range recorded. Empty
 *  cells are kept so every value stays under its own column. */
export function sheetBlocks(name: string, headers: string[], rows: string[][]): SourceBlock[] {
  const width = Math.max(headers.length, ...rows.map((row) => row.length), 0);
  const head = `Columns: ${Array.from({ length: width }, (_, at) => headers[at] ?? "").join(" | ")}`;

  return Array.from({ length: Math.ceil(rows.length / ROWS_PER_BLOCK) }, (_, block) => {
    const from = block * ROWS_PER_BLOCK;
    const slice = rows.slice(from, from + ROWS_PER_BLOCK);
    const lines = slice.map((row) => Array.from({ length: width }, (_, at) => row[at] ?? "").join(" | "));

    return {
      text: `${head}\n${lines.join("\n")}`,
      sheet: name,
      rowFrom: from + 1,
      rowTo: from + slice.length,
    };
  });
}

export function csvBlocks(rows: string[][]): { blocks: SourceBlock[]; meta: TableMeta } {
  const headers = rows[0] ?? [];
  const data = rows.slice(1);

  return {
    blocks: sheetBlocks("CSV", headers, data),
    meta: { kind: "table", sheets: [{ name: "CSV", headers, rowCount: data.length }] },
  };
}

/** h1-h6, paragraphs and table rows, in document order. Mammoth wraps a cell
 *  body in its own <p>, so tables are matched as a whole before paragraphs. */
export function docxHtmlToBlocks(html: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  let heading: string | undefined;
  const token = /<table[\s\S]*?<\/table>|<h([1-6])[^>]*>([\s\S]*?)<\/h\1>|<p[^>]*>([\s\S]*?)<\/p>/gi;

  for (const match of html.matchAll(token)) {
    if (match[0].startsWith("<table")) {
      for (const row of match[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => plain(cell[1]));
        if (cells.length > 0) blocks.push(heading ? { text: cells.join(" | "), heading } : { text: cells.join(" | ") });
      }
      continue;
    }

    const text = plain(match[1] ? match[2] : match[3]);
    if (text.length === 0) continue;

    if (match[1]) {
      heading = text;
      blocks.push({ text, heading });
    } else {
      blocks.push(heading ? { text, heading } : { text });
    }
  }

  return blocks;
}

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** A markdown heading owns the text beneath it. */
function markdownBlocks(text: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  let heading: string | undefined;
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body.length > 0) blocks.push(heading ? { text: body, heading } : { text: body });
    buffer = [];
  };

  for (const line of text.split("\n")) {
    const found = /^#{1,6}\s+(.+)$/.exec(line);

    if (found) {
      flush();
      heading = found[1].trim();
      blocks.push({ text: heading, heading });
      continue;
    }

    buffer.push(line);
  }

  flush();
  return blocks;
}
```

- [ ] Replace `pdfText` with `pdfBlocks` that returns page-numbered blocks (the page loop is unchanged, only the return type and the empty check move):

```ts
async function pdfBlocks(bytes: Buffer): Promise<SourceBlock[]> {
  const pdfjs = await import("pdfjs-dist");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableFontFace: true });
  const pages: string[] = [];

  try {
    const document = await task.promise;

    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ").trim());
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }

  const blocks = pagesToBlocks(pages);

  if (blocks.length === 0) {
    throw new ExtractError(
      "SOURCE_UNSUPPORTED",
      "That PDF has no text layer, so nothing could be read. It is probably a scan; upload page images or a text export instead.",
    );
  }

  return blocks;
}
```

- [ ] Replace `sheetText` with `xlsxBlocks` (headers from row 1, data from row 2, every column read so empties keep their place):

```ts
async function xlsxBlocks(bytes: Buffer): Promise<{ blocks: SourceBlock[]; meta: TableMeta }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(bytes).buffer);

  const blocks: SourceBlock[] = [];
  const sheets: TableMeta["sheets"] = [];

  for (const sheet of workbook.worksheets) {
    const rows: string[][] = [];
    let width = 0;

    sheet.eachRow({ includeEmpty: false }, (row) => {
      width = Math.max(width, row.cellCount);
      const cells: string[] = [];
      for (let column = 1; column <= row.cellCount; column += 1) cells.push(String(row.getCell(column).text ?? "").trim());
      rows.push(cells);
    });

    if (rows.length === 0) continue;

    const padded = rows.map((row) => Array.from({ length: width }, (_, at) => row[at] ?? ""));
    const headers = padded[0] ?? [];
    const data = padded.slice(1);

    blocks.push(...sheetBlocks(sheet.name, headers, data));
    sheets.push({ name: sheet.name, headers, rowCount: data.length });
  }

  if (blocks.length === 0) {
    throw new ExtractError("SOURCE_EMPTY", "That workbook was empty.");
  }

  return { blocks, meta: { kind: "table", sheets } };
}
```

- [ ] Add `extractSource`, keep `extractDocument` as a thin wrapper so nothing else breaks:

```ts
export async function extractSource(file: { bytes: Buffer; mime: string; name: string }): Promise<Extracted> {
  const extension = extensionOf(file.name);

  switch (extension) {
    case "txt":
      return { blocks: [{ text: expectText(decode(file.bytes), "That file was empty.") }], meta: null, extractTokens: 0 };

    case "md":
      return { blocks: expectBlocks(markdownBlocks(decode(file.bytes)), "That file was empty."), meta: null, extractTokens: 0 };

    case "csv": {
      const parsed = csvBlocks(parseCsv(decode(file.bytes)));
      return { blocks: expectBlocks(parsed.blocks, "That CSV was empty."), meta: parsed.meta, extractTokens: 0 };
    }

    case "docx":
      return { blocks: expectBlocks(await readable(docxBlocks, file.name), "That document was empty."), meta: null, extractTokens: 0 };

    case "xlsx": {
      const parsed = await readable(xlsxBlocks, file.name);
      return { blocks: expectBlocks(parsed.blocks, "That workbook was empty."), meta: parsed.meta, extractTokens: 0 };
    }

    case "pdf":
      return { blocks: await readable(pdfBlocks, file.name), meta: null, extractTokens: 0 };

    case "xls":
      throw new ExtractError("SOURCE_UNSUPPORTED", "The old .xls format cannot be read. Open it in Excel and save it as .xlsx, then upload that.");

    default:
      throw new ExtractError("SOURCE_UNSUPPORTED", `A ${extension ? `.${extension}` : "file of that type"} is not one the agent can read.`);
  }
}

function expectBlocks(blocks: SourceBlock[], sentence: string): SourceBlock[] {
  if (blocks.every((block) => block.text.trim().length === 0)) throw new ExtractError("SOURCE_EMPTY", sentence);
  return blocks.filter((block) => block.text.trim().length > 0);
}

/** Kept for callers that want one string; the pipeline uses blocks. */
export async function extractDocument(file: { bytes: Buffer; mime: string; name: string }): Promise<string> {
  return (await extractSource(file)).blocks.map((block) => block.text).join("\n\n");
}
```

- [ ] Add `docxBlocks`, with the raw-text fallback the audit asked for:

```ts
async function docxBlocks(bytes: Buffer): Promise<SourceBlock[]> {
  const html = await mammoth.convertToHtml({ buffer: bytes });
  const blocks = docxHtmlToBlocks(html.value);

  if (blocks.length > 0) return blocks;

  // A document mammoth cannot convert still has paragraphs; do not lose them.
  const raw = await mammoth.extractRawText({ buffer: bytes });
  return raw.value.split(/\n{2,}/).map((text) => ({ text: text.trim() })).filter((block) => block.text.length > 0);
}
```

- [ ] Delete the now-unused `sheetText`, `csvToText` and `cellsOf`. Run `npm run typecheck`; `noUnusedLocals` will name anything left behind.

### Step 2.3: Chunking spends the context

- [ ] Add to `Backend/src/agents/knowledge.chunk.ts`:

```ts
import type { SourceBlock } from "./extract";

export interface ChunkDraft {
  text: string;
  page?: number;
  sheet?: string;
  rowFrom?: number;
  rowTo?: number;
  heading?: string;
}

/**
 * Blocks to chunks, without ever claiming a page it does not have.
 *
 * Two blocks are packed only when they share a page, a sheet and a heading and
 * neither is part of a table: a row range that spans two blocks is a range the
 * citation would have to invent, and a repeated "Columns:" line in the middle
 * of a chunk reads like a second table.
 */
export function chunkBlocks(blocks: SourceBlock[]): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  let open: ChunkDraft | null = null;

  const flush = () => {
    if (open && open.text.trim().length > 0) chunks.push(open);
    open = null;
  };

  for (const block of blocks) {
    const pieces = block.text.length <= CHUNK_CHARS ? [block.text] : splitText(block.text);

    for (const piece of pieces) {
      const compatible =
        open !== null &&
        open.page === block.page &&
        open.sheet === block.sheet &&
        open.heading === block.heading &&
        open.rowFrom === undefined &&
        block.rowFrom === undefined &&
        open.text.length + piece.length + 2 <= CHUNK_CHARS;

      if (compatible && open) {
        open.text = `${open.text}\n\n${piece}`;
        continue;
      }

      flush();
      open = {
        text: piece,
        ...(block.page !== undefined ? { page: block.page } : {}),
        ...(block.sheet !== undefined ? { sheet: block.sheet } : {}),
        ...(block.rowFrom !== undefined ? { rowFrom: block.rowFrom } : {}),
        ...(block.rowTo !== undefined ? { rowTo: block.rowTo } : {}),
        ...(block.heading !== undefined ? { heading: block.heading } : {}),
      };
    }
  }

  flush();
  return chunks;
}
```

### Step 2.4: `index()` writes the provenance

- [ ] In `Backend/src/agents/knowledge.service.ts`, change `readSource` to return `Extracted`:

```ts
private async readSource(source: {
  id: string;
  kind: "TEXT" | "FILE";
  title: string;
  mime: string | null;
  storagePath: string | null;
  agent: { model: string };
}): Promise<Extracted> {
  if (source.kind === "TEXT") {
    throw new ExtractError("SOURCE_EMPTY", "That note had no text.");
  }

  if (!source.storagePath) {
    throw new ExtractError(
      "SOURCE_EMPTY",
      "This source has no stored file to read. Upload it again.",
    );
  }

  const bytes = await this.storage.download(source.storagePath);
  const mime = resolveMime(source.mime, source.title);

  if (mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/")) {
    const read = await this.media.read({ bytes, mime, name: source.title, model: source.agent.model });
    return { blocks: [{ text: read.text }], meta: null, extractTokens: read.tokens };
  }

  return extractSource({ bytes, mime, name: source.title });
}
```

(`read.tokens` arrives in Task 3; until then return `0`. Write the Task 2 version with `extractTokens: 0` and change one line in Task 3.)

- [ ] In `index()`, replace the extraction and chunking head:

```ts
      const extracted: Extracted =
        source.text && source.text.length > 0
          ? { blocks: [{ text: source.text }], meta: (source.meta as TableMeta | null) ?? null, extractTokens: source.extractTokens }
          : await this.readSource(source);

      // A long extraction is the one phase with no paid call to renew the
      // lease, so renew it here: otherwise a 24 MB PDF looks like a dead
      // process and a second worker starts the same work (B-16).
      await this.prisma.knowledgeSource.updateMany({
        where: { id: source.id, status: "PROCESSING" },
        data: { updatedAt: new Date() },
      });

      const drafts = chunkBlocks(extracted.blocks);
      const text = extracted.blocks.map((block) => block.text).join("\n\n");

      if (drafts.length === 0) throw new ExtractError("SOURCE_EMPTY", "There was no readable text in that source.");
      if (drafts.length > MAX_CHUNKS) {
        throw new ExtractError("SOURCE_TOO_LARGE", `That document splits into ${drafts.length} chunks, over the ${MAX_CHUNKS} limit. Split it or upload the part that matters.`);
      }
```

- [ ] `createMany` writes the new columns:

```ts
      await this.prisma.knowledgeChunk.createMany({
        data: drafts.map((chunk, ord) => ({
          sourceId: source.id,
          ord,
          text: chunk.text,
          tokens: estimateTokens(chunk.text),
          page: chunk.page ?? null,
          sheet: chunk.sheet ?? null,
          rowFrom: chunk.rowFrom ?? null,
          rowTo: chunk.rowTo ?? null,
          heading: chunk.heading ?? null,
        })),
      });
```

- [ ] The READY write adds `meta` and `extractTokens`. `undefined` means "leave what is there", which keeps the upload-time image metadata written in Task 3:

```ts
        data: {
          text,
          charCount: text.length,
          chunkCount: rows.length,
          embedTokens,
          extractTokens: extracted.extractTokens,
          meta: extracted.meta ?? undefined,
          status: "READY",
          error: null,
          indexedAt: new Date(),
        },
```

- [ ] Add `meta: true` and `replacesSourceId: true` to `loadForIndex`'s `select`, and to the `source` parameter type of `readSource`/`loadForIndex`.

### Step 2.5: The prompt and the citation say where

- [ ] In `Backend/src/agents/reply.prompt.ts`, export `contextBlock` and label each chunk:

```ts
export function contextBlock(chunks: ContextChunk[]): string {
  if (chunks.length === 0) return "Reference material: (none was found for this question.)";

  let used = 0;
  const lines: string[] = [];

  for (const chunk of chunks) {
    if (used + chunk.text.length > MAX_CONTEXT_CHARS) break;

    used += chunk.text.length;
    lines.push(`[${labelOf(chunk)}]\n${chunk.text}`);
  }

  return `Reference material:\n\n${lines.join("\n\n---\n\n")}`;
}

/** Where the words came from, in the same brackets as the title. Only the
 *  retrieved slice is named — `meta` is never pasted in wholesale (D4). */
function labelOf(chunk: ContextChunk): string {
  const where: string[] = [];

  if (chunk.page) where.push(`page ${chunk.page}`);
  if (chunk.sheet) {
    where.push(`sheet "${chunk.sheet}"${chunk.rowFrom ? ` rows ${chunk.rowFrom}–${chunk.rowTo}` : ""}`);
  }
  if (chunk.heading && chunk.heading !== chunk.title) where.push(chunk.heading);

  return where.length > 0 ? `${chunk.title} · ${where.join(" · ")}` : chunk.title;
}
```

- [ ] In `Backend/src/agents/agents.service.ts`, add the location to the citation so the playground shows it:

```ts
      const citations = chunks.map((chunk) => ({
        sourceId: chunk.sourceId,
        title: chunk.title,
        score: Math.round(chunk.score * 1000) / 1000,
        text: chunk.text.slice(0, 400),
        page: chunk.page,
        sheet: chunk.sheet,
        rowFrom: chunk.rowFrom,
        rowTo: chunk.rowTo,
      }));
```

### Step 2.6: Gate 2

- [ ] `npm run typecheck` — `noUnusedLocals` catches a dangling `csvToText`.
- [ ] `npm test`.
- [ ] `npm run build`.
- [ ] Manual check on a dev database (**not production**): upload a 3-page PDF, confirm the list's `chunkCount` is at least 3 and that a playground answer cites `page 2` when it should.

**Rollback:** revert the commit. Rows written by this task carry `page`/`sheet`/… values that the previous code ignores, and `knowledge_sources.text` is still the concatenated form, so retrieval keeps working unchanged.

---

## Task 3: Image metadata and extraction cost

**Files:**
- Create: `Backend/src/common/image-bytes.ts`
- Modify: `Backend/src/templates/template-media.ts` (import the moved helpers)
- Create: `Backend/src/agents/image.probe.ts`
- Create: `Backend/src/agents/image.probe.test.ts`
- Modify: `Backend/src/agents/extract.media.ts`
- Modify: `Backend/src/agents/knowledge.service.ts` (`store` meta, `readSource` tokens)

**Interfaces:**
- Consumes: `readSource`'s `Extracted` shape from Task 2.
- Produces: `probeImage(bytes)`; `OpenAiMediaExtractor.read()` → `{ text, tokens }`; `SourceMeta` gains `{ kind: "image" }` and `{ kind: "document" }`.

**Why move the byte readers:** the same JPEG/PNG/WebP segment walkers already exist in `template-media.ts` for Meta's header rules. Copying them into `agents/` would be the duplication the review rubric rejects; leaving them where they are would couple two features. Move them to `src/common/image-bytes.ts`, import from both.

### Step 3.1: Failing test

- [ ] Create `Backend/src/agents/image.probe.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { probeImage } from "./image.probe";

// 1×1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** GIF89a, little-endian width and height. */
const gif = (width: number, height: number) => {
  const head = Buffer.alloc(13);
  head.write("GIF89a", 0, "latin1");
  head.writeUInt16LE(width, 6);
  head.writeUInt16LE(height, 8);
  return head;
};

test("a PNG reports its own type and size", () => {
  assert.deepEqual(probeImage(PNG), { mime: "image/png", width: 1, height: 1 });
});

test("a GIF reports its size", () => {
  assert.deepEqual(probeImage(gif(2, 3)), { mime: "image/gif", width: 2, height: 3 });
});

test("a JPEG that cannot be walked is still a JPEG", () => {
  const got = probeImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]));
  assert.deepEqual(got, { mime: "image/jpeg", width: null, height: null });
});

test("a PDF is not an image", () => {
  assert.equal(probeImage(Buffer.from("%PDF-1.7")), null);
});
```

- [ ] Run `npm test`; fails because the module does not exist.

### Step 3.2: Move the readers, add the probe

- [ ] Create `Backend/src/common/image-bytes.ts` with `jpegSize`, `pngSize`, `webpSize` copied **verbatim** from `template-media.ts`, plus:

```ts
export function gifSize(bytes: Buffer): { width: number | null; height: number | null } {
  if (bytes.length < 10) return { width: null, height: null };
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}
```

- [ ] In `template-media.ts`, delete the three private functions and import them:

```ts
import { jpegSize, pngSize, webpSize } from "../common/image-bytes";
```

- [ ] Create `Backend/src/agents/image.probe.ts`:

```ts
import { gifSize, jpegSize, pngSize, webpSize } from "../common/image-bytes";

export type ProbedImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** The type the bytes prove, and its pixel size when it can be read. */
export function probeImage(bytes: Buffer): { mime: ProbedImageMime; width: number | null; height: number | null } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ...jpegSize(bytes) };
  }

  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: "image/png", ...pngSize(bytes) };
  }

  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    return { mime: "image/webp", ...webpSize(bytes) };
  }

  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString("latin1", 0, 6))) {
    return { mime: "image/gif", ...gifSize(bytes) };
  }

  return null;
}
```

- [ ] Run `npm test`; the probe suite passes and the template suite (none yet) compiles.

### Step 3.3: Extraction cost and image meta

- [ ] In `Backend/src/agents/extract.media.ts`, change the return type and both return statements. The signature becomes:

```ts
  async read(input: {
    bytes: Buffer;
    mime: string;
    name: string;
    /** The agent's model, so vision is read by the model that will answer. */
    model: string;
  }): Promise<{ text: string; tokens: number }> {
```

- [ ] the image branch ends with:

```ts
      const result = await this.provider.describeImage({
        bytes: input.bytes,
        mime,
        model: input.model,
      });

      // Vision is a paid call like any other: its tokens belong on the row.
      return { text: result.text, tokens: result.tokensIn + result.tokensOut };
```

- [ ] and the audio branch ends with:

```ts
      const result = await this.provider.transcribe({
        bytes: input.bytes,
        mime,
        name: input.name,
      });

      // Whisper's response carries no usage; zero is the honest number.
      return { text: result.text, tokens: 0 };
```

Both refusals (`video/`, unknown type) are unchanged.

- [ ] In `knowledge.service.readSource`, use it: `extractTokens: read.tokens`.
- [ ] In `store()`, accept an optional `meta` and compute the image's at upload:

```ts
  const meta =
    input.inspected.kind === "image"
      ? { kind: "image" as const, ...(probeImage(input.bytes) ?? { mime: input.inspected.mime, width: null, height: null }) }
      : undefined;
```

and pass `meta: meta ?? undefined` in `knowledgeSource.create`. Widen `SourceMeta`:

```ts
export type SourceMeta =
  | { kind: "table"; sheets: { name: string; headers: string[]; rowCount: number }[] }
  | { kind: "image"; mime: string; width: number | null; height: number | null }
  | { kind: "document"; pages: number | null };
```

- [ ] In `extractSource`'s PDF branch, set `meta: { kind: "document", pages: blocks.length }` so the row can say "12 pages". (The page count is the number of pages with text; blank pages are not counted.)

### Step 3.4: Gate 3

- [ ] `npm run typecheck`, `npm test`, `npm run build`.
- [ ] Manual: upload a PNG on dev; the row shows `extractTokens > 0` and `meta.width` is the real width. Upload a GIF; it still indexes.
- [ ] Confirm template image upload still works (same code path, moved helpers): open the template editor, upload a JPEG header, save.

**Rollback:** revert. `extract_tokens` and `meta` become unused columns; nothing reads them.

---

## Task 4: Replacement, lifecycle guards, runner fairness, orphan sweep

**Files:**
- Modify: `Backend/src/agents/knowledge.service.ts` (`replace`, `retireReplaced`, `retry`, `remove`, `index` budget)
- Modify: `Backend/src/agents/knowledge.controller.ts` (PUT route)
- Modify: `Backend/src/agents/ai.errors.ts` (`SOURCE_TIMEOUT`)
- Modify: `Backend/src/agents/agents.runner.ts` (`runPass`, `Promise.all`)
- Modify: `Backend/src/config/env.ts` (`KNOWLEDGE_JOB_BUDGET_MS`)
- Create: `Backend/src/agents/knowledge.sweep.ts` + `knowledge.sweep.test.ts`
- Create: `Backend/src/agents/agents.runner.test.ts`
- Create: `Backend/src/agents/knowledge.lifecycle.test.ts`
- Create: `Backend/scripts/sweep-knowledge-orphans.cjs`
- Modify: `Backend/package.json` (`knowledge:sweep`)

**Interfaces:**
- Consumes: `store()` from Task 1, `Extracted` from Task 2, `MetaStorage.list` from Task 1.
- Produces: `replace(claims, agentId, sourceId, file)`; `planSweep(input)`; `AgentsRunner.runPass()`.

### Step 4.1: `SOURCE_TIMEOUT` and the job budget

- [ ] In `ai.errors.ts`: `export type ExtractCode = "SOURCE_UNSUPPORTED" | "SOURCE_EMPTY" | "SOURCE_TOO_LARGE" | "SOURCE_TIMEOUT";`
- [ ] In `knowledge.service.ts`:

```ts
  private readonly jobBudgetMs: number;

  // in the constructor, after maxBytes
  this.jobBudgetMs = config.get<number>("KNOWLEDGE_JOB_BUDGET_MS") ?? 8 * 60 * 1000;
```

- [ ] In `env.ts`:

```ts
  /** A document may take this long to read and embed before it is stopped. */
  KNOWLEDGE_JOB_BUDGET_MS: z.coerce.number().int().positive().default(8 * 60 * 1000),
```

- [ ] In `index()`, add one statement as the first line inside the `try`, so the budget covers extraction as well as embedding:

```ts
    try {
      const started = Date.now();
```

- [ ] and the guard as the first statement of the embedding loop:

```ts
      for (let at = 0; at < rows.length; at += EMBED_BATCH) {
        if (Date.now() - started > this.jobBudgetMs) {
          throw new ExtractError(
            "SOURCE_TIMEOUT",
            "Reading this file took longer than the time allowed and was stopped. Try a smaller file, or split it and upload the part that matters.",
          );
        }

        const batch = rows.slice(at, at + EMBED_BATCH);
```

### Step 4.2: `retry()` becomes a conditional write (B-2, B-11)

- [ ] Replace the body:

```ts
    const reset = {
      status: "PENDING" as const,
      error: null,
      attempts: 0,
      // The old counts describe chunks that are about to be deleted.
      charCount: 0,
      chunkCount: 0,
      embedTokens: 0,
      extractTokens: 0,
      ...(source.kind === "FILE" ? { text: null } : {}),
    };

    // One conditional statement, not read-then-write: a claim landing between
    // the two would let a second attempt start on a row already being read,
    // and the two would delete each other's chunks (B-2).
    const updated = await this.prisma.knowledgeSource.updateMany({
      where: { id: source.id, status: { in: ["FAILED", "READY"] } },
      data: reset,
    });

    if (updated.count === 0) {
      throw new ConflictException({
        code: "SOURCE_BUSY",
        message: "This source is already queued or being read. Try again when it finishes.",
      });
    }

    const row = await this.prisma.knowledgeSource.findUniqueOrThrow({ where: { id: source.id } });

    return { source: sourceView(row) };
```

- [ ] `sourceOf` must now select `status` and `sha256` as well:

```ts
    select: { id: true, kind: true, status: true, sha256: true, storagePath: true, title: true },
```

### Step 4.3: `remove()` refuses to delete a live job

- [ ] Replace the delete:

```ts
    // A row being read is a running job's subject: deleting it mid-flight leaves
    // the worker writing into a row that no longer exists. The UI already hides
    // the button; this is the authority.
    const deleted = await this.prisma.knowledgeSource.deleteMany({
      where: { id: source.id, agentId: agent.id, status: { not: "PROCESSING" } },
    });

    if (deleted.count === 0) {
      throw new ConflictException({
        code: "SOURCE_BUSY",
        message: "This source is being read right now. Delete it when it finishes.",
      });
    }

    // Chunks went with the row (cascade). The object has no foreign key, so the
    // sweeper is the net if this call cannot reach storage.
    if (source.storagePath) await this.storage.remove([source.storagePath]);

    return { deleted: true };
```

### Step 4.4: `replace()` — the old knowledge survives until the new one is READY (D6)

- [ ] Add to `KnowledgeService`:

```ts
  /**
   * Safe replacement.
   *
   * A second row is written and indexed while the old one keeps answering:
   * retrieval only reads `READY` rows, so the old knowledge is available until
   * the new source is proven. The old row is deleted inside the transaction
   * that marks the new one READY, and nowhere else — a replacement that fails
   * leaves the working source exactly as it was.
   */
  async replace(
    claims: AuthClaims,
    agentId: string,
    sourceId: string,
    file: UploadedMedia,
  ): Promise<{ source: SourceView }> {
    const { workspaceId, userId } = await this.workspaces.primaryFor(claims);
    const agent = await this.agentOf(workspaceId, agentId);
    const target = await this.sourceOf(agent.id, sourceId);

    if (target.kind !== "FILE") {
      throw new ConflictException({ code: "SOURCE_NOT_FILE", message: "A typed note is edited, not replaced. Delete it and write the new one." });
    }

    if (target.status === "PENDING" || target.status === "PROCESSING") {
      throw new ConflictException({ code: "SOURCE_BUSY", message: "Wait for the current upload to finish, then replace it." });
    }

    const inspected = inspectUpload({
      name: file.originalname,
      declaredMime: file.mimetype ?? "",
      bytes: file.buffer,
      limit: this.maxBytes,
    });

    if (target.sha256 && target.sha256 === inspected.sha256) {
      throw new ConflictException({ code: "SOURCE_UNCHANGED", message: "That is the same file. Upload the new version." });
    }

    return this.store({
      agentId: agent.id,
      workspaceId,
      userId,
      id: randomUUID(),
      inspected,
      bytes: file.buffer,
      replacesSourceId: source.id,
    });
  }
```

- [ ] In `index()`, replace the READY write with the paired version. Read the predecessor before the transaction so its object can be removed after it commits:

```ts
      const predecessor = source.replacesSourceId
        ? await this.prisma.knowledgeSource.findFirst({
            where: { id: source.replacesSourceId, agentId: source.agentId },
            select: { id: true, storagePath: true },
          })
        : null;

      const markReady = this.prisma.knowledgeSource.updateMany({
        where: { id: source.id, status: "PROCESSING" },
        data: { text, charCount: text.length, chunkCount: rows.length, embedTokens, extractTokens: extracted.extractTokens, meta: extracted.meta ?? undefined, status: "READY", error: null, indexedAt: new Date() },
      });

      // The delete is conditional on the new row having actually become READY
      // in the statement before it. Same pattern as `recoverStale`: inside one
      // array transaction the second statement sees the first one's effect, and
      // the relation filter protects a row a live runner touched.
      const [updated, retired] = predecessor
        ? await this.prisma.$transaction([
            markReady,
            this.prisma.knowledgeSource.deleteMany({
              where: {
                id: predecessor.id,
                agentId: source.agentId,
                agent: { sources: { some: { id: source.id, status: "READY" } } },
              },
            }),
          ])
        : [await markReady, { count: 0 }];

      if (updated.count > 0 && retired.count > 0 && predecessor?.storagePath) {
        // The bytes are the old version nobody can reach now. Best effort: the
        // sweeper catches a failed delete.
        await this.storage.remove([predecessor.storagePath]);
      }

      if (updated.count > 0) {
        this.logger.log(`Indexed ${rows.length} chunks for source ${source.id} (${source.title}).`);
      }
```

- [ ] `loadForIndex` must select `agentId: true` and `replacesSourceId: true`.

### Step 4.5: The runner stops head-of-line blocking (B-10)

- [ ] Rewrite `agents.runner.ts`:

```ts
  private async runPass(): Promise<void> {
    if (this.busy) return;
    this.busy = true;

    try {
      await this.knowledge.recoverStale();
      await this.replies.releaseStale();

      // Independent rows, independent tables. Awaiting indexing before claiming
      // a reply meant one tenant's five-minute price book delayed every other
      // tenant's customer by exactly that long (B-10). Each branch still
      // contains its own failure.
      await Promise.all([this.indexOne(), this.answerOne()]);
    } finally {
      this.busy = false;
    }
  }

  private async indexOne(): Promise<void> {
    try {
      const source = await this.knowledge.claim();
      if (source) await this.knowledge.index(source);
    } catch (error) {
      this.logger.error(`Index pass failed: ${messageOf(error)}`);
    }
  }

  private async answerOne(): Promise<void> {
    try {
      const run = await this.replies.claim();
      if (run) await this.replies.answer(run);
    } catch (error) {
      this.logger.error(`Reply pass failed: ${messageOf(error)}`);
    }
  }
```

with `onModuleInit` calling `() => void this.runPass()`, and:

```ts
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown failure";
}
```

- [ ] Create `Backend/src/agents/agents.runner.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { AgentsRunner } from "./agents.runner";

test("a failing index still lets the reply be answered", async () => {
  let answered = 0;

  const knowledge = {
    recoverStale: async () => undefined,
    claim: async () => "source-1",
    index: async () => { throw new Error("index exploded"); },
  };
  const replies = {
    releaseStale: async () => undefined,
    claim: async () => { answered += 1; return "run-1"; },
    answer: async () => undefined,
  };

  const runner = new AgentsRunner(knowledge as any, replies as any);
  await runner.runPass();

  assert.equal(answered, 1);
});

test("both kinds are claimed in the same pass", async () => {
  const claimed: string[] = [];

  const runner = new AgentsRunner(
    { recoverStale: async () => undefined, claim: async () => { claimed.push("source"); return null; }, index: async () => undefined } as any,
    { releaseStale: async () => undefined, claim: async () => { claimed.push("run"); return null; }, answer: async () => undefined } as any,
  );

  await runner.runPass();

  assert.deepEqual(claimed.sort(), ["run", "source"]);
});
```

### Step 4.6: The orphan sweeper

- [ ] Create `Backend/src/agents/knowledge.sweep.ts` (pure planning, so it can be tested):

```ts
/** How long an object may be unreferenced before it is treated as garbage.
 *  An upload writes bytes before its row, so a short window would delete a
 *  file whose insert is still in flight. */
export const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;

export interface SweptObject {
  path: string;
  updatedAt: string | null;
}

/**
 * Orphans are objects no row names, older than the grace period. An object with
 * no usable timestamp is never deleted: "unknown age" is not evidence of
 * garbage.
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

/** Walks the two path families and returns object paths, folders excluded. */
export async function collectObjects(
  list: (prefix: string, options: { limit: number; offset: number }) => Promise<{ name: string; updatedAt: string | null; folder: boolean }[]>,
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

      if (page.length < 1000) break;
      offset += 1000;
    }
  }

  return out;
}
```

- [ ] Create `Backend/src/agents/knowledge.sweep.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { planSweep } from "./knowledge.sweep";

const now = Date.parse("2026-11-26T00:00:00Z");
const old = "2026-11-01T00:00:00Z";

test("an unreferenced object past the grace period is an orphan", () => {
  assert.equal(planSweep({ objects: [{ path: "a", updatedAt: old }], live: new Set(), now }).length, 1);
});

test("a referenced object is kept however old it is", () => {
  assert.equal(planSweep({ objects: [{ path: "a", updatedAt: old }], live: new Set(["a"]), now }).length, 0);
});

test("a fresh object is kept: its row may still be in flight", () => {
  assert.equal(planSweep({ objects: [{ path: "a", updatedAt: new Date(now - 60_000).toISOString() }], live: new Set(), now }).length, 0);
});

test("an object with no usable timestamp is never deleted", () => {
  assert.equal(planSweep({ objects: [{ path: "a", updatedAt: null }, { path: "b", updatedAt: "not a date" }], live: new Set(), now }).length, 0);
});
```

- [ ] Create `Backend/scripts/sweep-knowledge-orphans.cjs` (operator-run; dry run by default):

```js
#!/usr/bin/env node
/**
 * Deletes stored knowledge objects no row names.
 *
 * Dry run by default; `--apply` is the only way to delete. Run against a
 * development project first. Requires `npm run build` because it loads the
 * compiled planner.
 */
const { PrismaClient } = require("@prisma/client");
const { collectObjects, planSweep } = require("../dist/agents/knowledge.sweep");

const BUCKET = process.env.AGENT_SOURCE_BUCKET ?? "agent-sources";
const BASE = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "";
const APPLY = process.argv.includes("--apply");

if (!BASE || !KEY) { console.error("SUPABASE_URL and a service-role key are required."); process.exit(1); }

async function list(prefix, { limit, offset }) {
  const response = await fetch(`${BASE}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ prefix, limit, offset, sortBy: { column: "name", order: "asc" } }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) throw new Error(`list ${prefix} answered ${response.status}`);

  return (await response.json()).flatMap((row) =>
    row.name ? [{ name: row.name, updatedAt: row.updated_at ?? null, folder: row.id === null }] : [],
  );
}

(async () => {
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.knowledgeSource.findMany({
      where: { storagePath: { not: null } },
      select: { storagePath: true },
    });
    const live = new Set(rows.map((row) => row.storagePath));
    const objects = await collectObjects(list, ["workspaces/", "agents/"]);
    const orphans = planSweep({ objects, live, now: Date.now() });

    console.log(`${objects.length} objects, ${live.size} referenced, ${orphans.length} orphaned`);
    for (const orphan of orphans.slice(0, 200)) console.log(`${APPLY ? "delete" : "would delete"} ${orphan.path}`);

    if (APPLY && orphans.length > 0) {
      for (let at = 0; at < orphans.length; at += 100) {
        const slice = orphans.slice(at, at + 100).map((orphan) => orphan.path);
        const response = await fetch(`${BASE}/storage/v1/object/${BUCKET}`, {
          method: "DELETE",
          headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" },
          body: JSON.stringify({ prefixes: slice }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) console.error(`delete batch answered ${response.status}`);
      }
    }

    if (!APPLY) console.log("Dry run. Re-run with --apply to delete.");
  } finally {
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
```

- [ ] Add `"knowledge:sweep": "node scripts/sweep-knowledge-orphans.cjs"` to `Backend/package.json`.

### Step 4.7: The lifecycle suite

- [ ] Create `Backend/src/agents/knowledge.lifecycle.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictException } from "@nestjs/common";

import { KnowledgeService } from "./knowledge.service";
import { CLAIMS, FakePrisma, FakeProvider, FakeStorage, FakeWorkspaces } from "./testing/fakes";

const build = (config: Record<string, unknown> = {}) => {
  const prisma = new FakePrisma();
  const storage = new FakeStorage();
  const service = new KnowledgeService(
    prisma as any, new FakeWorkspaces() as any, storage as any, new FakeProvider() as any, {} as any,
    { get: (key: string) => config[key] } as any,
  );
  return { prisma, storage, service };
};

test("retry of a PROCESSING source is a 409 and changes nothing", async () => {
  const { prisma, service } = build();
  (prisma.knowledgeSource as any).findFirst = async () => ({ id: "s1", kind: "FILE", status: "PROCESSING", sha256: "x", storagePath: "p", title: "t" });
  (prisma.knowledgeSource as any).updateMany = async () => ({ count: 0 });

  await assert.rejects(() => service.retry(CLAIMS, "agent-1", "s1"), (error: any) =>
    error instanceof ConflictException && error.getResponse().code === "SOURCE_BUSY",
  );
  assert.equal(prisma.calls.filter((call) => call.path === "knowledgeSource.deleteMany").length, 0);
});

test("retry of a FAILED source resets every counter", async () => {
  const { prisma, service } = build();
  (prisma.knowledgeSource as any).findFirst = async () => ({ id: "s1", kind: "FILE", status: "FAILED", sha256: "x", storagePath: "p", title: "t" });

  await service.retry(CLAIMS, "agent-1", "s1");

  const write = prisma.calls.find((call) => call.path === "knowledgeSource.updateMany");
  assert.equal(write?.args.data.chunkCount, 0);
  assert.equal(write?.args.data.attempts, 0);
  assert.equal(write?.args.data.text, null);
});

test("deleting a PROCESSING source is refused", async () => {
  const { prisma, storage, service } = build();
  (prisma.knowledgeSource as any).findFirst = async () => ({ id: "s1", kind: "FILE", status: "PROCESSING", sha256: "x", storagePath: "p", title: "t" });
  (prisma.knowledgeSource as any).deleteMany = async () => ({ count: 0 });

  await assert.rejects(() => service.remove(CLAIMS, "agent-1", "s1"), ConflictException);
  assert.equal(storage.removed.length, 0);
});

test("a replacement writes a new row and leaves the old one READY", async () => {
  const { prisma, storage, service } = build();
  const created: any[] = [];
  (prisma.knowledgeSource as any).findFirst = async (args: any) =>
    args.where.sha256 ? null : { id: "old", kind: "FILE", status: "READY", sha256: "oldhash", storagePath: "old/path", title: "old.pdf" };
  (prisma.knowledgeSource as any).create = async ({ data }: any) => { created.push(data); return data; };

  const { source } = await service.replace(CLAIMS, "agent-1", "old", {
    buffer: Buffer.from("%PDF-1.7\nnew"), originalname: "new.pdf", mimetype: "application/pdf", size: 13,
  } as any);

  assert.equal(created[0].replacesSourceId, "old");
  assert.equal(source.status, "PENDING");
  assert.equal(prisma.calls.filter((call) => call.path === "knowledgeSource.deleteMany").length, 0);
  assert.deepEqual(storage.removed, []);
});

test("replacing with the identical file is refused before anything is written", async () => {
  const { prisma, storage, service } = build();
  const bytes = Buffer.from("%PDF-1.7\nsame");
  const { sha256Of } = await import("./knowledge.file");
  (prisma.knowledgeSource as any).findFirst = async () => ({ id: "old", kind: "FILE", status: "READY", sha256: sha256Of(bytes), storagePath: "p", title: "t" });

  await assert.rejects(() => service.replace(CLAIMS, "agent-1", "old", {
    buffer: bytes, originalname: "same.pdf", mimetype: "application/pdf", size: bytes.length,
  } as any), ConflictException);
  assert.equal(storage.uploaded.length, 0);
});

test("a failed replacement leaves the old source untouched", async () => {
  const { prisma, storage, service } = build();
  (prisma.knowledgeSource as any).findFirst = async () => ({ id: "old", kind: "FILE", status: "READY", sha256: "oldhash", storagePath: "old/path", title: "t" });
  (prisma.knowledgeSource as any).create = async () => { throw new Error("row refused"); };

  await assert.rejects(() => service.replace(CLAIMS, "agent-1", "old", {
    buffer: Buffer.from("%PDF-1.7\nnew"), originalname: "new.pdf", mimetype: "application/pdf", size: 13,
  } as any));

  assert.equal(prisma.calls.filter((call) => call.path === "knowledgeSource.deleteMany").length, 0);
  assert.deepEqual(storage.removed.map((paths) => paths[0]), ["workspaces/ws-a/agents/agent-1/knowledge/" + storage.uploaded[0].path.split("/knowledge/")[1]]);
});

test("a typed note cannot be replaced", async () => {
  const { prisma, service } = build();
  (prisma.knowledgeSource as any).findFirst = async () => ({ id: "n1", kind: "TEXT", status: "READY", sha256: null, storagePath: null, title: "note" });

  await assert.rejects(() => service.replace(CLAIMS, "agent-1", "n1", {
    buffer: Buffer.from("%PDF-1.7"), originalname: "x.pdf", mimetype: "application/pdf", size: 8,
  } as any), ConflictException);
});
```

### Step 4.8: Gate 4

- [ ] `npm run typecheck`, `npm test`, `npm run build`.
- [ ] Dev database, not production: upload A, upload B as a replacement of A; while B is `Queued`, ask the playground a question A answers — it must still answer. When B turns `Ready`, A must disappear and the object under A's old path must be gone.
- [ ] `npm run knowledge:sweep` (dry run, dev project) prints counts and deletes nothing.
- [ ] Confirm `Backend/prisma/migrations/0021_agent_transfers/` does not appear in `git status`.

**Rollback:** revert the commit. New-path rows stay readable, and any source that replaced another simply keeps both rows (the older one still `READY`) — the previous behaviour. Nothing in Task 4 destroys data outside a committed transaction.

---

## Task 5: The screen — view, replace, honest limits, located citations

**Depends on:** Task 1 (the `download` route, the 409 codes, `meta`/`extractTokens` on the list) and Task 2 (citations carry `page`/`sheet`/`rowFrom`/`rowTo`). Reads no column directly — every field arrives through the API.

**Files:**
- Modify: `frontend/src/features/ai-assistant/types.ts`
- Modify: `frontend/src/features/ai-assistant/api.ts`
- Modify: `frontend/src/lib/api/http.ts`
- Modify: `frontend/src/features/ai-assistant/components/upload-dropzone.tsx`
- Modify: `frontend/src/features/ai-assistant/components/source-list.tsx`
- Modify: `frontend/src/features/ai-assistant/components/training-panel.tsx`
- Modify: `frontend/src/features/ai-assistant/components/playground.tsx`

**Interfaces:**
- Consumes: `GET /v1/agents/:id/sources`, `GET …/sources/:sourceId/download`, `PUT …/sources/:sourceId/file`; `Source.meta`, `Source.extractTokens`, `Source.replacesSourceId`; `AskResult.citations[].page|sheet|rowFrom|rowTo`; codes `SOURCE_DUPLICATE`, `SOURCE_UNCHANGED`, `SOURCE_BUSY`, `SOURCE_NOT_FILE`, `SOURCE_UNSUPPORTED`, `SOURCE_TOO_LARGE`.
- Produces: nothing. This is the last task, and nothing downstream imports from it.

> **Ruled: no synthetic `UPLOADING` row.** The upload answers in about a second, and a fifth status the server never sends would need special cases in the list, the poller's `working` check and the delete guard — three places to get wrong for one second of feedback. `busy` already renders "Uploading…" on the drop target. The row appears when the server has one.

> **Ruled: no frontend test runner in this cycle.** The screen's logic that can be wrong — which fields exist, which endpoint, which method — is exactly what `tsc` checks, and the frontend has no test harness to extend. Adding one now would be a second test infrastructure to maintain for assertions weaker than the type system's. The backend carries the tests; the screen is verified by Gate 5's manual script, listed step by step.

### Step 5.1: Types, limits and the two new calls

- [ ] In `types.ts`, add immediately after the existing `SourceStatus` line (`SourceStatus` itself does not change):

```ts
/**
 * The server's ceilings, stated once.
 *
 * Four copies of "25 MB", and a note box that promised 400,000 characters
 * while the textarea refused the 40,001st, is how a user learns not to trust
 * the counter. These are the API's numbers. The server stays the authority:
 * `KNOWLEDGE_MAX_BYTES` may lower the upload ceiling and the client only finds
 * out when the server refuses — which is why the refusal text, not the
 * counter, is what a person acts on.
 */
export const LIMITS = {
  uploadBytes: 25 * 1024 * 1024,
  title: 160,
  noteBody: 400_000,
} as const;

/** What a file *is*, never what it says. Mirrors the server's `SourceMeta`. */
export type SourceMeta =
  | { kind: "table"; sheets: { name: string; headers: string[]; rowCount: number }[] }
  | { kind: "image"; mime: string; width: number | null; height: number | null }
  | { kind: "document"; pages: number | null };
```

- [ ] In the same file, add to `Source` after `embedTokens`:

```ts
  /** Tokens spent reading an image or a voice note. 0 for documents. */
  extractTokens: number;
  /** Sheet names, pixel size or page count — metadata, never content. */
  meta: SourceMeta | null;
  /** The source this one was uploaded to replace. Null for a first upload. */
  replacesSourceId: string | null;
```

- [ ] Replace `AskResult`'s citation element with the located version:

```ts
  citations: {
    sourceId: string;
    title: string;
    score: number;
    text: string;
    /** 1-based PDF page; null when the source has no pages. */
    page: number | null;
    sheet: string | null;
    rowFrom: number | null;
    rowTo: number | null;
  }[];
```

- [ ] In `frontend/src/lib/api/http.ts`, give `upload` a method. `PUT` is a replacement — the same bytes with a different intent, and the server refuses a PUT that would create a second row:

```ts
export async function upload<T>(
  path: string,
  form: FormData,
  method: "POST" | "PUT" = "POST",
): Promise<T> {
  const headers = await sessionHeaders(false);

  return send<T>(path, { method, body: form }, headers);
}
```

- [ ] In `api.ts`, add two calls next to `uploadSource`. There is deliberately no wrapper for `GET …/sources/:sourceId`: the list already carries every field a row shows, and an exported function nobody calls is dead code the next reader has to check.

```ts
/** A 300-second link, asked for on click and never cached: it is meant to expire. */
export function sourceDownloadLink(
  id: string,
  sourceId: string,
): Promise<{ url: string; expiresIn: number }> {
  return request<{ url: string; expiresIn: number }>(
    `/v1/agents/${id}/sources/${sourceId}/download`,
    { method: "GET" },
  );
}

/**
 * Replace a file. The new version is indexed while the old one keeps
 * answering; the old source disappears only once the new one is READY.
 */
export function replaceSource(
  id: string,
  sourceId: string,
  file: File,
): Promise<{ source: Source }> {
  const form = new FormData();
  form.append("file", file);

  return upload<{ source: Source }>(
    `/v1/agents/${id}/sources/${sourceId}/file`,
    form,
    "PUT",
  );
}
```

### Step 5.2: One extension list, exported

- [ ] In `upload-dropzone.tsx`, replace `MAX_BYTES` and `ACCEPT` with one list. The picker offers it, the drag check uses it, and `SourceList` imports it — a replacement picker that offered a narrower set than the uploader would be the same class of defect as the note counter:

```ts
import { LIMITS } from "../types";

/**
 * Every format the API can read, in one place. The picker offers these; a drag
 * bypasses the filter and so does a browser that ignores `accept`, which is
 * why `send` checks the same list again before the bytes leave.
 */
export const SOURCE_EXTENSIONS = [
  "txt",
  "md",
  "csv",
  "docx",
  "xlsx",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "ogg",
  "oga",
  "mp3",
  "m4a",
  "wav",
  "flac",
  "opus",
  "webm",
] as const;

export const SOURCE_ACCEPT = SOURCE_EXTENSIONS.map((one) => `.${one}`).join(",");
```

- [ ] In `send`, replace the size guard and add the extension guard before it. Order matters: a 40 MB `.exe` should be refused by name, not by size:

```ts
  async function send(file: File) {
    if (busy) return;

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

    if (!(SOURCE_EXTENSIONS as readonly string[]).includes(extension)) {
      toast.push({
        title: "That file cannot be read",
        description: `${file.name} is not a format an agent can learn from. Upload a PDF, Word, Excel, CSV, text, an image or a voice note.`,
        tone: "error",
      });
      return;
    }

    if (file.size > LIMITS.uploadBytes) {
      toast.push({
        title: "Too large",
        description: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${LIMITS.uploadBytes / 1024 / 1024} MB.`,
        tone: "error",
      });
      return;
    }
```

- [ ] Point the input at the shared constant: `accept={SOURCE_ACCEPT}`.
- [ ] Leave the "PDF, Word, Excel, CSV, text, images and voice notes up to 25 MB" line as prose. A sentence that lists formats is readable; a sentence generated from the array would be one more thing to keep in step.

### Step 5.3: A row that can be opened and replaced

- [ ] Replace `source-list.tsx` in full. The new row adds **View** (a signed link, opened in a tab), **Replace** (a file picker, `PUT`), the file's format and shape, the upload date, and the reading-token count:

```tsx
"use client";

import * as React from "react";
import {
  Eye,
  FileText,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  ApiError,
  deleteSource,
  replaceSource,
  retrySource,
  sourceDownloadLink,
} from "../api";
import { LIMITS } from "../types";
import type { Source, SourceMeta, SourceStatus } from "../types";
import { SOURCE_ACCEPT } from "./upload-dropzone";

const STATUS: Record<SourceStatus, { label: string; className: string }> = {
  PENDING: { label: "Queued", className: "border-border bg-secondary text-muted-foreground" },
  PROCESSING: { label: "Indexing", className: "border-brand/40 bg-brand-soft text-foreground" },
  READY: { label: "Ready", className: "border-whatsapp/40 bg-whatsapp/10 text-foreground" },
  FAILED: { label: "Failed", className: "border-destructive/40 bg-destructive/5 text-foreground" },
};

function sizeOf(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The format, taken from the stored title — the server kept the sniffed one. */
function typeOf(source: Source): string {
  if (source.kind === "TEXT") return "Note";

  const extension = source.title.split(".").pop();
  return extension && extension !== source.title ? extension.toUpperCase() : "File";
}

/** What the file is, in the words a person would use. */
function whereOf(meta: SourceMeta | null): string {
  if (!meta) return "";

  if (meta.kind === "table") {
    const names = meta.sheets.map((sheet) => sheet.name).join(", ");
    return meta.sheets.length === 1 ? `sheet ${names}` : `${meta.sheets.length} sheets: ${names}`;
  }

  if (meta.kind === "image") {
    return meta.width && meta.height ? `${meta.width}×${meta.height}` : meta.mime;
  }

  return meta.pages ? `${meta.pages} page${meta.pages === 1 ? "" : "s"}` : "";
}

/** A date, not a timestamp: the minute of an upload is never the question. */
function dateOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

/**
 * One row per source. The status word is the state; the failure reason sits
 * under it, because "Failed" alone tells nobody what to do next.
 *
 * `Replace` uploads a second file for the same source. The current version
 * keeps answering every question until the new one has been read, so the toast
 * promises exactly that and no more.
 */
export function SourceList({
  agentId,
  sources,
  onChanged,
}: {
  agentId: string;
  sources: Source[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [armed, setArmed] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [replacing, setReplacing] = React.useState<Source | null>(null);
  const picker = React.useRef<HTMLInputElement>(null);

  function complain(title: string, caught: unknown, fallback: string) {
    toast.push({
      title,
      description: caught instanceof ApiError ? caught.message : fallback,
      tone: "error",
    });
  }

  async function remove(source: Source) {
    setBusy(source.id);

    try {
      await deleteSource(agentId, source.id);
      setArmed(null);
      onChanged();
      toast.push({
        title: "Source removed",
        description: `${source.title} and everything indexed from it are gone.`,
        tone: "success",
      });
    } catch (caught) {
      complain("Could not remove the source", caught, "The source stayed.");
    } finally {
      setBusy(null);
    }
  }

  async function retry(source: Source) {
    setBusy(source.id);

    try {
      await retrySource(agentId, source.id);
      onChanged();
      toast.push({
        title: "Queued again",
        description: `${source.title} will be read on the next pass.`,
        tone: "success",
      });
    } catch (caught) {
      complain("Could not queue the source", caught, "Nothing changed.");
    } finally {
      setBusy(null);
    }
  }

  async function view(source: Source) {
    setBusy(source.id);

    try {
      const { url } = await sourceDownloadLink(agentId, source.id);

      // `noopener` so the opened page cannot reach back through window.opener.
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      complain("Could not open the file", caught, "The link was not issued.");
    } finally {
      setBusy(null);
    }
  }

  async function replace(file: File) {
    const target = replacing;
    setReplacing(null);
    if (!target) return;

    if (file.size > LIMITS.uploadBytes) {
      toast.push({
        title: "Too large",
        description: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${LIMITS.uploadBytes / 1024 / 1024} MB.`,
        tone: "error",
      });
      return;
    }

    setBusy(target.id);

    try {
      await replaceSource(agentId, target.id, file);
      onChanged();
      toast.push({
        title: "Replacement started",
        description: `${target.title} stays searchable until the new version has been read.`,
        tone: "success",
      });
    } catch (caught) {
      complain("Could not replace the file", caught, "The current version is unchanged.");
    } finally {
      setBusy(null);
    }
  }

  if (sources.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-card/60 px-3 py-4 text-[12.5px] leading-relaxed text-muted-foreground">
        No material yet. Add a price list, a policy or a voice note above — an
        agent cannot be activated until one source is ready.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* One picker for every row: `click()` is synchronous, so the browser
          still counts it as the user's gesture and opens the dialog. */}
      <input
        accept={SOURCE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void replace(file);

          // Cleared so choosing the same file again still fires a change.
          event.target.value = "";
        }}
        ref={picker}
        type="file"
      />

      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {sources.map((source) => {
          const style = STATUS[source.status];
          const Icon = source.kind === "TEXT" ? FileText : ImageIcon;
          const working = busy === source.id;
          const pending = source.status === "PENDING" || source.status === "PROCESSING";
          const isFile = source.kind === "FILE";

          return (
            <li className="flex items-start gap-3 px-3.5 py-3" key={source.id}>
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                <Icon className="size-4" aria-hidden="true" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {source.title}
                  </p>
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      style.className,
                    )}
                  >
                    {style.label}
                  </span>
                </div>

                <p className="mt-0.5 text-[11.5px] tabular-nums text-muted-foreground">
                  {[
                    typeOf(source),
                    sizeOf(source.size),
                    whereOf(source.meta),
                    source.charCount ? `${source.charCount.toLocaleString()} chars` : "",
                    source.chunkCount ? `${source.chunkCount} chunks` : "",
                    dateOf(source.createdAt),
                    source.status === "READY" ? "searchable" : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>

                {source.error ? (
                  <p className="mt-1 text-[11.5px] leading-relaxed text-destructive">
                    {source.error}
                  </p>
                ) : null}

                {source.status === "READY" &&
                source.embedTokens + source.extractTokens > 0 ? (
                  <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {source.embedTokens.toLocaleString()} embedding tokens
                    {source.extractTokens > 0
                      ? ` · ${source.extractTokens.toLocaleString()} reading tokens`
                      : ""}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {isFile ? (
                  <button
                    aria-label={`Open ${source.title}`}
                    className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none disabled:opacity-50"
                    disabled={working}
                    onClick={() => void view(source)}
                    type="button"
                  >
                    {working ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Eye className="size-3.5" aria-hidden="true" />
                    )}
                  </button>
                ) : null}

                {isFile && !pending ? (
                  <button
                    aria-label={`Replace ${source.title}`}
                    className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none disabled:opacity-50"
                    disabled={working}
                    onClick={() => {
                      setReplacing(source);
                      picker.current?.click();
                    }}
                    type="button"
                  >
                    <Upload className="size-3.5" aria-hidden="true" />
                  </button>
                ) : null}

                {source.status === "FAILED" ? (
                  <button
                    className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none"
                    disabled={working}
                    onClick={() => void retry(source)}
                    type="button"
                  >
                    {working ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    Retry
                  </button>
                ) : null}

                {armed === source.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      className="inline-flex h-8 items-center rounded-md bg-destructive/10 px-2 text-[12px] font-medium text-destructive transition-colors hover:bg-destructive/15 focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none"
                      disabled={working}
                      onClick={() => void remove(source)}
                      type="button"
                    >
                      {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Delete
                    </button>
                    <button
                      className="h-8 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none"
                      onClick={() => setArmed(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    aria-label={`Remove ${source.title}`}
                    className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none disabled:opacity-50"
                    disabled={working || pending}
                    onClick={() => setArmed(source.id)}
                    type="button"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] Note what did **not** change: the poller, `onChanged`, the confirm-then-delete flow and the status words. Only the row's contents and the two new actions are new.

### Step 5.4: The note box stops lying (B-12)

- [ ] In `training-panel.tsx`, delete the local cap and the local title length:

```ts
import { LIMITS } from "../types";

// deleted: const MAX_NOTE = 40_000;
```

and use the shared numbers — three single-line edits, each with its exact anchor:

```tsx
// 1. the counter, above the title input
-          {body.length.toLocaleString()} / {MAX_NOTE.toLocaleString()}
+          {body.length.toLocaleString()} / {LIMITS.noteBody.toLocaleString()}

// 2. the title input, three attributes below `id="note-title"`
-          maxLength={120}
+          maxLength={LIMITS.title}

// 3. the body textarea
-          maxLength={MAX_NOTE}
+          maxLength={LIMITS.noteBody}
```

Nothing else in `training-panel.tsx` moves: the poller, `addNote`, the empty-state copy and the `SourceList` contract stay exactly as they are.

- [ ] Leave the sentence "A note is indexed exactly like a file, and edited by deleting it and writing a new one." It is still true: a typed note has no hash and no file, so `replace()` refuses it with `SOURCE_NOT_FILE` — the UI does not offer the button for `kind === "TEXT"`.

### Step 5.5: A citation that says where

- [ ] In `playground.tsx`, add beside the component:

```tsx
/** Page, sheet or row range — the same words the prompt used. */
function whereOf(citation: AskResult["citations"][number]): string {
  const parts: string[] = [];

  if (citation.page) parts.push(`page ${citation.page}`);
  if (citation.sheet) {
    parts.push(
      `sheet "${citation.sheet}"${citation.rowFrom ? ` rows ${citation.rowFrom}–${citation.rowTo}` : ""}`,
    );
  }

  return parts.join(" · ");
}
```

- [ ] and render it in the citation's title line:

```tsx
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-[12px] font-medium text-foreground">
                        {citation.title}
                        {whereOf(citation) ? (
                          <span className="font-normal text-muted-foreground">
                            {" · "}
                            {whereOf(citation)}
                          </span>
                        ) : null}
                      </p>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {citation.score.toFixed(2)}
                      </span>
                    </div>
```

### Step 5.6: Gate 5

- [ ] `cd frontend; npm run lint`.
- [ ] `cd frontend; npx tsc --noEmit`.
- [ ] `cd frontend; npm run build`.
- [ ] `cd Backend; npm run typecheck; npm test` — nothing in the backend changed, and it must still be green.
- [ ] Manual, on a dev backend and a test workspace (never production):

| # | Action | Expected |
|---|---|---|
| 1 | Upload the same PDF twice | Second attempt: toast with the server's sentence naming the existing source; no second row |
| 2 | Upload a `.zip` renamed `.pdf` | Refused before upload completes; nothing in the list |
| 3 | Upload `.gif` | Row appears; `meta` yields pixel size; it reaches Ready |
| 4 | Click the eye on a PDF | A tab opens with the file; the URL is a Supabase signed link |
| 5 | Click Replace with a new PDF | Toast says the old file stays searchable; during indexing a question the old file answered still answers |
| 6 | Wait for the replacement to reach Ready | Old row gone from the list; the citation now names the new page numbers |
| 7 | Replace with the identical file | Toast `That is the same file. Upload the new version.` |
| 8 | Delete while `Indexing` | Button disabled; a forced call answers `SOURCE_BUSY` |
| 9 | Add a 45,000-character note | Accepted — the counter reads `/ 400,000` |
| 10 | Ask a question answered by page 2 of a PDF | The citation under the answer reads `… · page 2` |

**Rollback:** revert the commit. The API keeps serving the older frontend — every field the new screen reads was added in Task 1 and is additive, and the older screen ignores `meta`, `extractTokens` and `replacesSourceId`.

---

## Dependencies and gates (D9)

| Task | Depends on | Why it cannot start earlier | Gate |
|---|---|---|---|
| 1 — admission, storage, tenant proof | — | It applies the only migration and creates the test runner everything else uses | Gate 1 |
| 2 — extraction fidelity | 1 | Blocks carry provenance into chunk columns that only exist after the migration; the test fakes come from Task 1 | Gate 2 |
| 3 — image metadata, extraction cost | 1 | Writes `meta`/`extractTokens`, both added in Task 1; moves helpers Task 1 left in place | Gate 3 |
| 4 — replacement, lifecycle, fairness, sweep | 1, 2, 3 | `store()` and `readSource` are reshaped by 1–3, and `replace()` calls them; retiring a source needs Task 2's chunk provenance to stay consistent | Gate 4 |
| 5 — the screen | 1, 2 | Reads endpoints from Task 1 and citation fields from Task 2; it never touches the backend | Gate 5 |

Tasks 1→4 are strictly sequential: they edit the same four files (`knowledge.service.ts`, `knowledge.controller.ts`, `extract.ts`, `env.ts`). Task 5 touches only `frontend/` and could run in parallel with 3 and 4 by a second worker — it is sequenced last here so the API it consumes is already merged and Gate 5's manual script can run against it.

Each gate is a separate verification event: **no task's Gate may be run in the same sitting as the next task's first commit**. A red gate stops the sequence; the previous task's rollback applies.

**Ordering against the priority rule (requirement 2).** B-1 comes first because it is the only defect that stops *other tenants* working: one hung storage call parks the single runner and every reply queues behind it. B-2 and B-11 sit in Task 4 rather than Task 1 because their fix is the same conditional-write pattern as `replace()` and `remove()`, all three read `status` from one `sourceOf` selection, and one test file proves all three; splitting them out would triplicate the pattern to satisfy an ordering that only matters if Task 4 is never reached. Nothing between Task 1 and Task 4 calls `retry()` except the existing button, so the window does not widen.

---

## Test matrix

Every case runs against `FakePrisma`, `FakeStorage`, `FakeProvider` and `FakeWorkspaces`. No test opens a socket, reads an environment variable or touches a database. Runner: `tsc -p tsconfig.test.json` into `.test-dist`, then `node --test .test-dist`. **52 cases across 10 files.**

| Area | File | Cases | Covers |
|---|---|---|---|
| Admission | `knowledge.file.test.ts` | 10 | D2, D7, B-4, B-5: sniffing over the declared MIME, zip/docx/xlsx disambiguation, renamed archives, binary-renamed-text, GIF, unknown extension, size cap before hashing, hash stability, title cap |
| Isolation | `knowledge.tenant.test.ts` | 4 | Foreign id → 404 with zero storage calls and zero mutations; no workspace parameter to forge; download refused before signing; retry refused |
| Service | `knowledge.service.test.ts` | 5 | Workspace-scoped path with hash, unsupported file never reaches storage, duplicate is 409 with nothing stored, unique-index race compensated, retrieval scoped by workspace |
| Extraction | `extract.test.ts` | 8 | B-6 page numbering; B-7 quoted commas/newlines and empty cells; header repetition with row ranges; sheet names; B-14 DOCX headings and tables; empty text refusal |
| Chunking | `knowledge.chunk.test.ts` | 5 | Pages never merged, long page splits keeping the page, prose packing, table blocks alone with their row range, heading starts a chunk |
| Prompt | `reply.prompt.test.ts` | 3 | D3 label rendering: page, sheet + rows, bare title |
| Image probe | `image.probe.test.ts` | 4 | PNG, GIF, unwalkable JPEG, PDF rejected |
| Runner | `agents.runner.test.ts` | 2 | B-10: a failing index still answers; both kinds claimed in one pass |
| Sweep | `knowledge.sweep.test.ts` | 4 | B-17: orphan past grace, referenced kept, fresh kept, no timestamp never deleted |
| Lifecycle | `knowledge.lifecycle.test.ts` | 7 | B-2 retry guard, B-11 counter reset, B-8 guarded delete, D6 replacement keeps the old READY, D7 identical replacement refused, failed replacement preserves the old source, typed note not replaceable |

**What the matrix deliberately does not claim.** Stated here so nothing is silently omitted (requirement 1):

| Item | How it is verified instead | Why not a test |
|---|---|---|
| B-1 storage timeout | Code reading + Gate 1 (a blackholed host) | The fix is one line per `fetch`; a test would stub `globalThis.fetch` and then assert the stub received the signal — it tests the mock, not the network |
| B-3 vision tokens | Gate 3 manual: `extractTokens > 0` after a PNG | Both branches call a paid provider; a fake provider returning a fixed count would prove only that addition works |
| B-15 image size in the list | Gate 5 row 3 | Same reason: the probe is unit-tested; the plumbing is one field |
| PDF/DOCX byte fixtures | `pagesToBlocks` and `docxHtmlToBlocks` are tested directly | Building a real 2-page PDF or a DOCX without a new dependency is a fragile binary fixture; the library call is a one-liner around the tested function |
| Frontend behaviour | Gate 5's ten-row script | No test harness exists; see the ruling above Task 5's steps |
| Cross-tenant at the database | Application-layer tests only | There is no RLS, so the database has no policy to test. That is a known limitation, recorded below |

**Reliability invariants that must stay untouched, and are asserted by not being edited:** `EMBED_DIMS = 1536`, the `vector(1536)` column, the HNSW cosine index, `TOP_K = 6`, `FLOOR = 0.25`, `MAX_CONTEXT_CHARS = 6_000`, `CHUNK_CHARS`, `OVERLAP_CHARS`, `MAX_CHUNKS`. If a diff touches any of them, the change is out of scope for this plan.

---

## Risks

| # | Risk | Impact | Mitigation | How it would show up |
|---|---|---|---|---|
| R-1 | The retirement transaction fails while the new row is READY | Two READY versions of one file; answers may cite either | The delete is relation-filtered inside the same array transaction as the READY write, and the object is removed only after commit. On mismatch the old row is simply left | List shows two rows with the same title; delete the older one |
| R-2 | Concurrent `index()` on the same source | Duplicate chunks | Unchanged claim lease (`SKIP LOCKED` + `updatedAt` renewal); Task 4 adds extraction to the renewal points | `chunkCount` higher than expected |
| R-3 | A workbook exceeds `MAX_CHUNKS` (5,000) | The tail of a very large sheet is never searched | Existing cap, kept. `chunkCount` makes it visible | `chunkCount` pegged at 5,000 |
| R-4 | `Promise.all` in the runner increases concurrent claims | Two leases at once on a small database | One per kind per pass, no overlap with the tick; `recoverStale` still runs first | Lease contention in logs |
| R-5 | The citation label lengthens the prompt | Slightly more tokens; a shorter context window for text | Labels are outside `MAX_CONTEXT_CHARS`, and only retrieval-selected chunks are labelled | Token counts in Activity |
| R-6 | Migration runs unattended | `start:prod` runs `prisma migrate deploy` at boot; a failure blocks startup | Additive DDL only; `ADD COLUMN … DEFAULT 0` is metadata-only on PG 11+; a snapshot before deploy | Render boot log |
| R-7 | `0021_agent_transfers` lands after `0022` | Prisma applies whichever is pending, in name order | Both are additive and independent; neither number is changed by the other | `_prisma_migrations` order |
| R-8 | Signed URL leaks through history or a shared screen | Anyone with the URL reads one file for five minutes | Bucket stays private; 300 s lifetime; link issued only after an ownership check | Not detectable; accepted |
| R-9 | A duplicate slips past the lookup on a network retry | Two rows, double embedding cost | `@@unique([agentId, sha256])` refuses the second insert and the object is removed (P2002 path) | 409 seen by the user |
| R-10 | Legacy `.xls`, archives, `.doc` still refused | Users surprise | The refusal text names the supported formats; unchanged behaviour | Failure row with the reader's message |

No risk in this plan justifies Redis, BullMQ or any new service. The one hard concurrency problem — two workers, one source — is already solved by the lease that exists, and the replacement ordering is solved by a transaction the database already offers.

---

## Rollback strategy

**Per task.** Each task is one commit; reverting it is the rollback. Nothing in Tasks 2–5 destroys data: they add fields, add one route, and change which function reads a row.

**Code before schema.** If Task 1 must be undone, revert the code **and leave the columns**: the previous build selects explicitly and ignores every added column, the unique index does not affect inserts with `sha256 = NULL`, and the extra index costs nothing on write volume this size. Run `rollback.sql` only if the release is abandoned outright, and only after the old build is confirmed healthy.

**Ordering of the destructive pieces.** The only deletions this plan performs are: the predecessor row inside the READY transaction, the object after that commit, and `remove()`'s best-effort delete. All three are behind a conditional write, so a revert never leaves a row whose object is gone.

**Objects written by new code.** They live under `workspaces/{workspaceId}/agents/{agentId}/knowledge/{sourceId}/…` and are reached through `storagePath`, which the previous code already reads. A revert therefore keeps every upload readable; nothing needs moving back.

**Emergency levers, no redeploy of logic.** `KNOWLEDGE_MAX_BYTES` lowers the upload ceiling and `KNOWLEDGE_JOB_BUDGET_MS` shortens a job. Both are read at boot, so they take effect on the next Render restart, not instantly — say so if asked to "switch it off now". A database snapshot taken before deploy is the last resort.

**Deployment sequence, when it is approved separately.** Merge → Render builds (`npm ci && npm run build`) → `start:prod` runs `prisma migrate deploy` → instance serves. This plan does none of it. Before that deploy an operator takes a Supabase snapshot and confirms `0021_agent_transfers` is either applied or still absent-but-intact.

---

## Out of scope

- OCR, and therefore scanned PDFs: refused with the existing clear message (**D5**). An image-only PDF that yields no text is a `FAILED` row with that message, not a silent empty index.
- Row-level security and any database policy. Isolation stays application-layer; the audit found no RLS and this plan does not add one.
- Re-embedding, a new embedding model, different dimensions, or tuning `TOP_K`/`FLOOR`.
- Moving existing storage objects to the new path.
- Editing a typed note in place, version history, or a "previous versions" list. Replacement keeps exactly one live version.
- Archives, `.doc`, `.xls`, `.pptx`, or converting between formats.
- Structured **facts** stored as JSON and injected into prompts (**D4**): table rows stay as chunk text with sheet and row provenance, retrieved by the same cosine search. No JSON document is pasted into a prompt and no value is coerced or normalised.
- A second worker or any queue infrastructure.
- The AgentRouter, the agent-transfer plan and `0021_agent_transfers`.

---

## What approval covers

1. **One migration**, `0022_knowledge_fidelity`: five columns and two indexes on `knowledge_sources`, five columns on `knowledge_chunks`. Additive, no backfill, no enum change, no re-embedding. `0021_agent_transfers` is not opened.
2. **Three endpoint changes**, all in `knowledge.controller.ts`: one new GET (download), one new PUT (replace), and `retry`/`delete` gain a 409 guard. Mutations stay `@Roles("OWNER")`; reads stay member-wide.
3. **Two optional environment variables**, both with defaults: `KNOWLEDGE_MAX_BYTES`, `KNOWLEDGE_JOB_BUDGET_MS`. No secret, no new service.
4. **Defects fixed:** B-1…B-13 by severity, plus B-14…B-17 found in the same audit, each mapped in "Scope map" and in the test matrix. Priority order is enforced by task order: B-1 and B-2/B-11 are in Tasks 1 and 4, and Task 4 does not begin until Gate 3 is green.
5. **Preserved:** the reply flow, `AgentRouter`, agent-to-agent routing, embeddings at 1536, `TOP_K`, `FLOOR`, workspace and agent isolation, GIF/vision/Whisper, and the private bucket with 300-second links.
6. **52 automated tests** in 10 files, all against fakes, including the cross-tenant suite (foreign agent id, pre-signing refusal, forged workspace parameter, foreign retry).
7. **Not performed by this plan:** `prisma migrate deploy`, `prisma migrate dev`, any production write, any deploy.

**Files touched, for a reviewer's checklist.** Backend, new: `knowledge.file.ts`, `knowledge.sweep.ts`, `image.probe.ts`, `common/image-bytes.ts`, `scripts/sweep-knowledge-orphans.cjs`, `tsconfig.test.json`, and ten `*.test.ts` files with `testing/fakes.ts`. Backend, modified: `knowledge.service.ts`, `knowledge.controller.ts`, `knowledge.chunk.ts`, `extract.ts`, `extract.media.ts`, `retrieval.service.ts`, `reply.prompt.ts`, `agents.service.ts`, `reply.service.ts`, `agents.runner.ts`, `inbox/media.storage.ts`, `templates/template-media.ts`, `config/env.ts`, `ai.errors.ts`, `package.json`, `.gitignore`, `prisma/schema.prisma`, and the new migration directory. Frontend, modified: `types.ts`, `api.ts`, `lib/api/http.ts`, `source-list.tsx`, `upload-dropzone.tsx`, `training-panel.tsx`, `playground.tsx`.

---

## Known limitation, recorded

Isolation is enforced in the service layer: every entry point resolves `workspaceId` from the token and filters by it, and Task 1 adds the missing `workspace_id` join to retrieval. The database itself has no guard, so a future query written without the filter would cross tenants silently. The cross-tenant tests catch that for the paths they cover — upload, retry, delete, download, retrieval — and not for a path nobody wrote yet. Closing that gap means RLS and a service-role rethink, which is a separate decision.

