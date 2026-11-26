# Agent-to-Agent Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the agent that owns a conversation cannot answer from its own material, let the reply pipeline consider a sibling agent on the same number, move the thread to it at most once, and answer in the new agent's voice — without ever speaking over a reassignment, a human takeover, or a second webhook.

**Architecture:** A transfer is *not* a second queued run. It happens inside the run that is already executing, after `RetrievalService` returns too little from the current owner. One embedding is computed once and reused across every candidate agent through a single `GROUP BY` query, a pure decision module picks one (or refuses), the ownership bind and the `aiOwnerVersion` bump happen in one conditional `UPDATE`, the model answers as the new agent, and a single `beforeSend` read revalidates ownership immediately before the WhatsApp call. The transfer ledger (`agent_transfers`) records every decision, including refusals, so the Activity tab can explain silence.

**Tech Stack:** NestJS 11 + Prisma 6.19.3 (PostgreSQL/Supabase, pgvector 0.8.2, `DIRECT_URL` for migrations) on the backend; Next 16 App Router + React 19 + Tailwind 4 on the frontend. No queue, no Redis, no test framework in the repo — the suite compiles with `tsc` into a git-ignored `.test-dist` and runs on Node's built-in `node --test`, so it needs no new dependency and no newer Node.

**Spec:** No new spec document was written for this feature. This plan implements the 13 requirements and the three rounds of review corrections agreed in session on 2026-11-26, and extends `Docs/superpowers/specs/2026-11-25-agents-design.md` (the design the pipeline it modifies came from). Where the two disagree, this plan wins for transfer behaviour only.

## Global Constraints

- **V1 scoring is frozen.** `TOP_K = 6`, `FLOOR = 0.25`, `vector(1536)`, the `<=>` cosine SQL and `SET LOCAL hnsw.iterative_scan = relaxed_order` are unchanged. The new constants govern only the *transfer* decision; none of them may be substituted into `RetrievalService.search()`.
- **Chunk-count bias is a known limitation, documented not fixed.** An agent with 400 chunks out-scores an agent with 3 for the same question, because the top-k maximum grows with corpus size. V1 accepts this and logs every score so it can be calibrated later.
- One conversation, one owner. `MAX_TRANSFERS = 1` per run; a transferred thread does not transfer again inside the same attempt.
- Only agents with `isActive = true` **and at least one `READY` source** are eligible for automatic fallback. An agent with no ready source is not a candidate — it would only produce a second handoff.
- Manual reassignment never resumes an AI-paused conversation. Nothing in this plan clears `aiPausedAt`.
- Outbound duplicate-message protection stays a separate task. This plan does not add a send idempotency key; `inboundMessageId @unique` remains the only run-level dedupe.
- **Fail closed.** If ownership cannot be validated, nothing is sent — no answer and no `HANDOFF_MESSAGE`.
- **Tokens are recorded on every terminal path.** A run that spent model tokens and sent nothing reports those tokens; `outboundMessageId` stays null. Model spend and outbound messages are separate columns, never inferred from each other.
- Never edit a migration file that has been applied anywhere — its checksum is recorded in `_prisma_migrations`.
- **Never run `prisma migrate dev` in this repo.** It needs a shadow database that is not configured, it targets the live production database over `DIRECT_URL`, and on drift it offers a reset. Migrations are hand-written and validated with `prisma migrate diff --from-schema-datamodel` (file-to-file, no connection).
- No new dependencies, no new background infrastructure. `AgentsRunner` stays the only loop.
- Backend gates: `npm run typecheck`, `npm run build`, `npx prisma validate`.
- Frontend gates: `npx tsc --noEmit`, `npx eslint src --max-warnings=0`, `npm run build`.
- Windows PowerShell: use `;` not `&&`. Write files with `[System.IO.File]::WriteAllLines(..., UTF8Encoding($false))` — `>` emits UTF-16.
- Conventional commits, one per task, issued from the workspace root `c:\Users\raman\Videos\Automation`.
- **Not in scope for any task:** applying the migration, deploying, changing environment variables.

## File map

```
Backend/prisma/schema.prisma                                  two enums, AgentTransfer, aiOwnerVersion
Backend/prisma/migrations/0021_agent_transfers/migration.sql   new table + one column, hand-written
Backend/src/agents/
  agent.transfer.ts          pure decision logic + thresholds + typed errors
  agent.router.ts            pick() extracted from choose()
  retrieval.service.ts       embedQuestion / searchByVector / topScores
  reply.service.ts           the attempt sequence, the guard, the ledger write
  agents.module.ts           no change (AgentTransfer needs no provider)
Backend/src/inbox/
  inbox.sender.ts            optional beforeSend hook
  inbox.service.ts           takeover stamped before the send, version bumped
Backend/src/agents/agents.service.ts   pause/resume bump the version
Backend/test/transfer/
  support/fakes.ts           fake Prisma, fake Graph
  support/harness.ts         a real ReplyService and a real InboxSender over the fakes
  decisions.test.ts          T0-T4d (pure)
  sender-guard.test.ts       S1-S3, the beforeSend mechanics
  attempt-transfer.test.ts   T5-T7e, the whole attempt
Backend/package.json         test:transfer script (compile, then run)
Backend/tsconfig.test.json   compiles src + test into .test-dist
Backend/.gitignore           .test-dist/
frontend/src/features/ai-assistant/
  types.ts                   Run.transfers
  components/activity-table.tsx   two reason labels, one transfer line
```

## Rulings already made (do not re-litigate)

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| R-1 | Transfer happens inside the executing run, not as a new `AgentRun` | Reuses `inboundMessageId @unique` and the single-run guarantee; a second run would need its own dedupe | Transfer is bounded by the run's timeout |
| R-2 | `OWNER_STRONG = 0.45` short-circuits before any candidate query | Requirement 13: no per-message churn | Agents with modest material may be transferred away from more often than ideal |
| R-3 | Reverse guard uses the ledger, not a time cooldown | A global 2-minute gate blocks genuine intent changes | A→B→A is possible if the subject genuinely changes and the score drifts ≥ 0.10 |
| R-4 | `aiOwnerVersion` compares a counter, not just `agentId` | Catches A→B→A between the read and the send | One extra integer column |
| R-5 | The guard reads `agent.isActive` in the same query | `deactivate()` writes no conversation row, so no bump can happen there | One join on every send |
| R-6 | `handoff()` is guarded *before* `pause()`, and its guard ignores `isActive` | Pausing first would bump the version the guard expects; checking `isActive` would block the revoked-key handoff that the same catch block just caused | A handoff can still race a human by the pause→send gap |
| R-7 | Abort errors are plain `Error` subclasses, never `ConflictException` | `reply.service.ts:475` maps `ConflictException` to `window-closed` | Misleading Activity rows |
| R-8 | No `FOR UPDATE` across the WhatsApp send | Needs an interactive transaction the pooler path avoids, and pins a connection for seconds | A single-digit-millisecond residual window remains |
| R-9 | An aborted attempt leaves a `FAILED` `Message` row — when the database is reachable to write it | `MessageStatus` has no non-delivery state, and adding one touches the status rank and the tick UI | "Failed deliveries" counts include deliberate aborts; `errorReason` disambiguates. If the write itself is refused the row stays `QUEUED`: T7b, T7c, limitation 4 |
| R-10 | Migration is hand-written, never `migrate dev` | Shadow DB absent, target is production, drift prompts a reset | A hand-written DDL mistake — mitigated by the diff check in Task 2 |
| R-11 | Tests are compiled by `tsc` and run by Node's built-in runner | The repo has no test framework, the plan adds no dependency, and compiled JavaScript sidesteps Node's decorator-transform gaps entirely | A `.test-dist` directory appears after a run; it is git-ignored |
| R-12 | The test fake is a small in-memory database, not a per-call `mockResolvedValue` chain | A guard test is only meaningful if the second read sees what the first write did | Every handler a test forgets to register throws instead of returning `undefined` |
| R-13 | Nothing is retried inside the attempt when the database refuses the abort's own bookkeeping | A retry against a dead pooler only delays the abort and pins the worker; the pre-existing `releaseStale()` sweep already requeues the run | The run stays `CLAIMED` until the sweep (up to ten minutes). The reply is late, not lost — the guard refused the send, so nothing was sent |

---

### Task 1: Schema — transfer ledger and ownership version

**Files:**
- Modify: `Backend/prisma/schema.prisma`

**Interfaces:**
- Produces: `AgentTransfer`, `AgentTransferTrigger`, `AgentTransferOutcome`, `Conversation.aiOwnerVersion`, and the back-relations consumed by Tasks 2, 3, 7 and 8.

- [ ] **Step 1: Add the two enums** immediately after `enum AgentRunStatus` and its closing brace.

```prisma
/// Who caused a transfer. `MANUAL` exists for a future assignment endpoint and
/// is never written in V1 — the reverse guard already reads it correctly, so
/// adding that endpoint later needs no migration.
enum AgentTransferTrigger {
  AUTOMATIC
  MANUAL
}

/// How a routing decision ended. `TRANSFERRED` is the only outcome that moved
/// the thread; every `ABORTED_*` value is the evidence behind a `SKIPPED` run
/// and answers "why did the agent stay silent" without replaying the decision.
enum AgentTransferOutcome {
  TRANSFERRED
  ABORTED_OWNER_STRONG
  ABORTED_NO_CANDIDATE
  ABORTED_MARGIN
  ABORTED_REVERSE
  ABORTED_LIMIT
  ABORTED_OWNER_CHANGED
  ABORTED_SEND_FAILED
}
```

- [ ] **Step 2: Add the model** immediately after `model AgentRun`.

```prisma
/// One routing decision. Written after the ownership bind, so a `TRANSFERRED`
/// row always means the thread really changed hands; an `ABORTED_*` row is
/// written even when nothing moved, because that is the answer to "why did
/// nobody reply".
///
/// Scores are nullable because a `MANUAL` row has no retrieval behind it. The
/// automatic path always fills both.
model AgentTransfer {
  id             String               @id @default(uuid()) @db.Uuid
  workspaceId    String               @map("workspace_id") @db.Uuid
  conversationId String               @map("conversation_id") @db.Uuid
  runId          String?              @map("run_id") @db.Uuid
  fromAgentId    String               @map("from_agent_id") @db.Uuid
  toAgentId      String               @map("to_agent_id") @db.Uuid
  fromScore      Float?               @map("from_score")
  toScore        Float?               @map("to_score")
  margin         Float?
  trigger        AgentTransferTrigger @default(AUTOMATIC)
  outcome        AgentTransferOutcome @default(TRANSFERRED)
  /// The scored candidates this decision saw, `[{agentId,name,score}]`, capped
  /// at three. Kept so a later calibration pass can see what was rejected.
  candidates     Json?
  createdAt      DateTime             @default(now()) @map("created_at")

  workspace    Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  run          AgentRun?    @relation(fields: [runId], references: [id], onDelete: SetNull)
  fromAgent    Agent        @relation("AgentTransferFrom", fields: [fromAgentId], references: [id], onDelete: Cascade)
  toAgent      Agent        @relation("AgentTransferTo", fields: [toAgentId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
  @@index([toAgentId, createdAt])
  @@index([runId])
  @@map("agent_transfers")
}
```

- [ ] **Step 3: Add `aiOwnerVersion` to `Conversation`**, directly after the `aiPauseReason` field.

```prisma
  /// Monotonic counter, bumped in the same UPDATE as every write that changes
  /// who may speak on this thread: the agent bind, both pauses, the resume and
  /// the human-takeover stamp. Compared immediately before a WhatsApp send, so
  /// an assignment that happened during the model call is seen — including
  /// A -> B -> A, where the agent id alone looks unchanged.
  aiOwnerVersion Int      @default(0) @map("ai_owner_version")
```

- [ ] **Step 4: Add the back-relations.** Four one-line additions, each next to the model's existing relation block.

```prisma
// in model Workspace
  transfers        AgentTransfer[]

// in model Conversation
  transfers        AgentTransfer[]

// in model AgentRun
  transfers        AgentTransfer[]

// in model Agent
  transfersFrom    AgentTransfer[] @relation("AgentTransferFrom")
  transfersTo      AgentTransfer[] @relation("AgentTransferTo")
```

- [ ] **Step 5: Validate**

Run: `cd Backend; npx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid 🚀`

Do **not** run `prisma generate`, `prisma migrate dev` or `prisma db push` yet — Task 2 verifies the DDL first.

- [ ] **Step 6: Commit**

```bash
git add Backend/prisma/schema.prisma
git commit -m "feat(agents): add transfer ledger and conversation ownership version"
```

---

### Task 2: Migration `0021_agent_transfers` — hand-written, never applied here

**Files:**
- Create: `Backend/prisma/migrations/0021_agent_transfers/migration.sql`

**Interfaces:**
- Consumes: the datamodel from Task 1.
- Produces: the `agent_transfers` table, its two enums, its indexes and five foreign keys, plus `conversations.ai_owner_version`.

**Why manual.** Verified state: Prisma CLI `6.19.3`; `datasource db` has `directUrl = env("DIRECT_URL")` and **no `shadowDatabaseUrl`**; 22 migrations exist with head `0020_message_soft_delete`; `prisma migrate status` reports *"Database schema is up to date!"*, so every migration through 0020 is applied to the production Supabase project. `prisma migrate dev` would require a shadow database, would connect to that production database, and on drift would offer `--force-reset`. It must not be run.

The identifier is `0021` because the highest existing prefix is `0020`. Duplicate prefixes already exist in this repo (`0004_inbox`/`0004_whatsapp_source`, `0005_business_profile`/`0005_templates`) and Prisma orders by full directory name, so `0021_agent_transfers` sorts last unambiguously.

- [ ] **Step 1: Confirm the pre-flight state**

Run: `cd Backend; npx prisma -v`
Expected: `prisma 6.19.3`

Run: `cd Backend; npx prisma migrate status`
Expected: `Database schema is up to date!`

- [ ] **Step 2: Produce the expected DDL without touching the database**

```powershell
New-Item -ItemType Directory -Force $env:TEMP\at-diff | Out-Null
git show HEAD:Backend/prisma/schema.prisma | Set-Content -Encoding utf8 $env:TEMP\at-diff\before.prisma
cd Backend
npx prisma migrate diff `
  --from-schema-datamodel $env:TEMP\at-diff\before.prisma `
  --to-schema-datamodel prisma\schema.prisma --script
```

`--from-schema-datamodel` is file-to-file: no connection, no shadow database, no drift check. Copy the output for the next step.

**Do not use `--from-schema-datasource`.** It reads the live database and emits `DROP INDEX "knowledge_chunks_embedding_idx"` plus other drops of objects Prisma cannot express in a datamodel. It is a foot-gun here, not a verification.

- [ ] **Step 3: Write the migration file** — the diff output, hand-formatted in this repo's house style (prose header, `-- CreateEnum` / `-- CreateTable` / `-- AlterTable` / `-- CreateIndex` / `-- AddForeignKey` separators, `_fkey` constraint names). The expected content is below; if step 2 printed anything materially different, the step-2 output wins and the difference is investigated before writing.

```sql
-- Routing between the agents on one number, and the counter that protects a
-- reply from outliving its owner.
--
-- A transfer is not a second queued run: it happens inside the run that is
-- already answering, after retrieval from the current owner came back thin.
-- This table is the ledger of that decision. A `TRANSFERRED` row means the
-- thread really changed hands, because it is written after the ownership bind;
-- an `ABORTED_*` row is written even when nothing moved, because it is the only
-- answer to "why did nobody reply".
--
-- `ai_owner_version` is the second half of the same idea. Every write that
-- changes who may speak bumps it in the same UPDATE, so a send can compare a
-- counter instead of an agent id — which is the only way to notice A -> B -> A
-- happening while the model is thinking.
--
-- No backfill: every existing conversation is at version 0 and nobody is
-- mid-send during a deploy.

-- CreateEnum
CREATE TYPE "AgentTransferTrigger" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "AgentTransferOutcome" AS ENUM ('TRANSFERRED', 'ABORTED_OWNER_STRONG', 'ABORTED_NO_CANDIDATE', 'ABORTED_MARGIN', 'ABORTED_REVERSE', 'ABORTED_LIMIT', 'ABORTED_OWNER_CHANGED', 'ABORTED_SEND_FAILED');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "ai_owner_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "agent_transfers" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "run_id" UUID,
    "from_agent_id" UUID NOT NULL,
    "to_agent_id" UUID NOT NULL,
    "from_score" DOUBLE PRECISION,
    "to_score" DOUBLE PRECISION,
    "margin" DOUBLE PRECISION,
    "trigger" "AgentTransferTrigger" NOT NULL DEFAULT 'AUTOMATIC',
    "outcome" "AgentTransferOutcome" NOT NULL DEFAULT 'TRANSFERRED',
    "candidates" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_transfers_conversation_id_created_at_idx" ON "agent_transfers"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_transfers_to_agent_id_created_at_idx" ON "agent_transfers"("to_agent_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_transfers_run_id_idx" ON "agent_transfers"("run_id");

-- AddForeignKey
ALTER TABLE "agent_transfers" ADD CONSTRAINT "agent_transfers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_transfers" ADD CONSTRAINT "agent_transfers_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_transfers" ADD CONSTRAINT "agent_transfers_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_transfers" ADD CONSTRAINT "agent_transfers_from_agent_id_fkey" FOREIGN KEY ("from_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_transfers" ADD CONSTRAINT "agent_transfers_to_agent_id_fkey" FOREIGN KEY ("to_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Verify the file mechanically**

```powershell
Select-String -Path Backend\prisma\migrations\0021_agent_transfers\migration.sql -Pattern 'DROP|ALTER COLUMN|knowledge_chunks|DELETE FROM|TRUNCATE'
```

Expected: **no output.** Any match means the file is wrong.

```powershell
Select-String -Path Backend\prisma\migrations\0021_agent_transfers\migration.sql -Pattern 'REFERENCES'
```

Expected: exactly five lines, referencing `workspaces`, `conversations`, `agent_runs`, `agents` (twice). Nothing else.

- [ ] **Step 5: Cross-check against the generated diff**

Compare the file against step 2's output statement by statement, in the same order. Both must contain: two `CREATE TYPE`, one `ALTER TABLE "conversations"`, one `CREATE TABLE`, three `CREATE INDEX`, five `ALTER TABLE ... ADD CONSTRAINT`. Any extra or missing statement means stop and investigate.

- [ ] **Step 6: Do not apply**

Confirm and stop: no `prisma migrate deploy`, no `prisma migrate resolve`, no `prisma db push`. Production applies this file at the next deploy, when `start:prod` runs `prisma migrate deploy && node dist/main`. The file is frozen from the moment it is applied anywhere — editing it afterwards changes its checksum and blocks every later deploy.

- [ ] **Step 7: Commit**

```bash
git add Backend/prisma/migrations/0021_agent_transfers/migration.sql
git commit -m "feat(agents): add 0021_agent_transfers migration"
```

---

### Task 3: `agent.transfer.ts` — the pure decision, and its typed errors

**Files:**
- Create: `Backend/src/agents/agent.transfer.ts`
- Test: `Backend/test/transfer/decisions.test.ts` (written in Task 9; the module is verified by `tsc` here)

**Interfaces:**
- Produces:
  - `OWNER_STRONG`, `TRANSFER_MARGIN`, `REVERSE_MARGIN`, `REVERSE_DRIFT`, `SAME_SUBJECT`, `MAX_TRANSFERS`, `MAX_TRANSFERS_24H`, `MAX_CANDIDATES`
  - `type TransferOutcome` (mirrors the Prisma enum as a string union)
  - `sameSubject(previous: string | null, current: string): boolean`
  - `type ScoredAgent = { agentId: string; name: string; score: number }`
  - `type TransferInput` / `type TransferDecision`
  - `decideTransfer(input: TransferInput): TransferDecision`
  - `class OwnerChangedError extends Error` with `readonly detail: string`
  - `class OwnerCheckError extends Error`
- Consumes: nothing. This module imports no Nest, no Prisma, no network.

- [ ] **Step 1: Write the module**

```ts
/**
 * Whether the agent that owns this thread should hand it to a sibling, and if
 * not, why. Pure: no clock, no database, no network — every input is a number
 * already fetched, so the whole decision is replayable from the ledger.
 *
 * Thresholds are deliberately blunt. A transfer is visible to the customer as
 * a change of voice, so the bar for moving is higher than the bar for staying:
 * the owner keeps the thread unless it is confidently lost.
 */

/** An owner scoring this well keeps the thread no matter who else answers. */
export const OWNER_STRONG = 0.45;

/** The challenger must beat the owner by this much to be worth a new voice. */
export const TRANSFER_MARGIN = 0.08;

/** Going back to the agent we just left needs a wider margin still. */
export const REVERSE_MARGIN = 0.15;

/** ...or a clearly different subject plus this much drift in the owner's score. */
export const REVERSE_DRIFT = 0.1;

/** Jaccard overlap at or above this means "the same question as before". */
export const SAME_SUBJECT = 0.5;

/** One transfer per run. A chain of three voices is not a conversation. */
export const MAX_TRANSFERS = 1;

/** Fuse, not a throttle: six automatic transfers a day on one thread is a loop. */
export const MAX_TRANSFERS_24H = 6;

/** Matches AgentRouter.MAX_CANDIDATES; scoring more than this is not worth the rows. */
export const MAX_CANDIDATES = 12;

export type TransferOutcome =
  | "TRANSFERRED"
  | "ABORTED_OWNER_STRONG"
  | "ABORTED_NO_CANDIDATE"
  | "ABORTED_MARGIN"
  | "ABORTED_REVERSE"
  | "ABORTED_LIMIT";

export type ScoredAgent = {
  agentId: string;
  name: string;
  score: number;
};

/**
 * The most recent transfer that put the current owner in charge, if any.
 * Read from `agent_transfers` where `to_agent_id = owner`, newest first.
 */
export type LastArrival = {
  fromAgentId: string;
  /** Null on a MANUAL row, which makes the drift test unavailable. */
  toScore: number | null;
};

export type TransferInput = {
  /** Retrieval score of the current owner, or null when it has no material. */
  ownerScore: number | null;
  /** Same-owner candidates, already filtered to active agents with a READY source. */
  candidates: ScoredAgent[];
  /** Most recent arrival into the current owner, if this thread ever moved. */
  last: LastArrival | null;
  /** The customer's previous inbound text, or null when there is none. */
  previousQuestion: string | null;
  /** The customer's current text. */
  question: string;
  /** Automatic transfers recorded on this conversation in the last 24h. */
  transfersLast24h: number;
};

export type TransferDecision = {
  outcome: TransferOutcome;
  /** Set only when outcome is TRANSFERRED. */
  to: ScoredAgent | null;
  /** Top three scored candidates, for the ledger. */
  ranked: ScoredAgent[];
  /** One sentence for the log line and the run's `error` column. */
  note: string;
};

/** Words that carry no subject: "do you have", "i need", "the". */
const STOP = new Set([
  "a", "about", "after", "all", "also", "am", "an", "and", "any", "are", "as",
  "at", "be", "been", "before", "but", "by", "can", "could", "did", "do", "does",
  "for", "from", "get", "got", "had", "has", "have", "he", "her", "here", "him",
  "his", "how", "i", "if", "in", "into", "is", "it", "its", "just", "know",
  "like", "me", "my", "need", "no", "not", "now", "of", "on", "or", "our",
  "out", "please", "she", "should", "so", "some", "tell", "than", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "to", "too", "up",
  "us", "want", "was", "we", "were", "what", "when", "where", "which", "who",
  "why", "will", "with", "would", "you", "your",
]);

function tokenSet(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP.has(word));

  return new Set(words);
}

/**
 * Is this still the same subject? A missing previous message counts as "yes":
 * with no evidence of a change, the safe answer is to keep the thread put.
 */
export function sameSubject(previous: string | null, current: string): boolean {
  if (previous === null) return true;

  const a = tokenSet(previous);
  const b = tokenSet(current);

  if (a.size === 0 || b.size === 0) return true;

  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;

  return shared / (a.size + b.size - shared) >= SAME_SUBJECT;
}

/** Highest score first; ties broken by id so the answer is never clock-dependent. */
function rank(candidates: ScoredAgent[]): ScoredAgent[] {
  return [...candidates].sort((a, b) =>
    b.score - a.score || a.agentId.localeCompare(b.agentId),
  );
}

export function decideTransfer(input: TransferInput): TransferDecision {
  const ranked = rank(input.candidates);
  const top = ranked.slice(0, 3);
  const base = { to: null as ScoredAgent | null, ranked: top };

  if (input.transfersLast24h >= MAX_TRANSFERS_24H) {
    return {
      ...base,
      outcome: "ABORTED_LIMIT",
      note: `${input.transfersLast24h} automatic transfers in 24h already; staying put.`,
    };
  }

  // The owner answers comfortably from its own material: no transfer, and no
  // candidate was worth reading.
  if (input.ownerScore !== null && input.ownerScore >= OWNER_STRONG) {
    return {
      ...base,
      outcome: "ABORTED_OWNER_STRONG",
      note: `Owner scored ${input.ownerScore.toFixed(3)}; strong enough to keep the thread.`,
    };
  }

  if (ranked.length === 0) {
    return {
      ...base,
      outcome: "ABORTED_NO_CANDIDATE",
      note: "No other active agent on this number has ready material.",
    };
  }

  const best = ranked[0];

  if (input.ownerScore !== null && best.score < input.ownerScore + TRANSFER_MARGIN) {
    return {
      ...base,
      outcome: "ABORTED_MARGIN",
      note: `Best sibling scored ${best.score.toFixed(3)}, not ${TRANSFER_MARGIN.toFixed(2)} above the owner's ${input.ownerScore.toFixed(3)}.`,
    };
  }

  // R1: the owner has no material at all, so there is nothing to be loyal to.
  if (input.ownerScore === null) {
    return {
      to: best,
      ranked: top,
      outcome: "TRANSFERRED",
      note: `Owner has no material; ${best.name} scored ${best.score.toFixed(3)}.`,
    };
  }

  if (input.last && input.last.fromAgentId === best.agentId) {
    // We are being asked to go back to the agent we just left.
    if (best.score >= input.ownerScore + REVERSE_MARGIN) {
      return {
        to: best,
        ranked: top,
        outcome: "TRANSFERRED",
        note: `Returning to ${best.name}: ${best.score.toFixed(3)} clears the owner's ${input.ownerScore.toFixed(3)} by ${REVERSE_MARGIN.toFixed(2)}.`,
      };
    }

    const drifted =
      input.last.toScore !== null &&
      input.last.toScore - input.ownerScore >= REVERSE_DRIFT;

    if (!sameSubject(input.previousQuestion, input.question) && drifted) {
      return {
        to: best,
        ranked: top,
        outcome: "TRANSFERRED",
        note: `New subject and the owner drifted ${(input.last.toScore! - input.ownerScore).toFixed(3)}; returning to ${best.name}.`,
      };
    }

    return {
      ...base,
      outcome: "ABORTED_REVERSE",
      note: `Refusing to bounce back to ${best.name} on the same subject.`,
    };
  }

  return {
    to: best,
    ranked: top,
    outcome: "TRANSFERRED",
    note: `${best.name} scored ${best.score.toFixed(3)} against the owner's ${input.ownerScore.toFixed(3)}.`,
  };
}

/**
 * The thread was reassigned, paused or switched off while this attempt was
 * thinking. Not an error condition — a decision not to speak.
 */
export class OwnerChangedError extends Error {
  constructor(readonly detail: string) {
    super("The thread changed hands before the reply was sent.");
    this.name = "OwnerChangedError";
  }
}

/**
 * The ownership check itself could not be completed — the database was
 * unreachable or the row vanished. Fail closed: nothing is sent.
 */
export class OwnerCheckError extends Error {
  constructor(readonly detail: string) {
    // The cause goes in the message as well as in `detail`: the message is
    // what reaches the FAILED outbound row, and "ETIMEDOUT" there is the
    // difference between a support answer and a shrug.
    super(`Ownership could not be verified before sending: ${detail}`);
    this.name = "OwnerCheckError";
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd Backend; npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add Backend/src/agents/agent.transfer.ts
git commit -m "feat(agents): add pure transfer decision module"
```

---

### Task 4: `AgentRouter.pick()` — extract the model call, keep `choose()` behaviour

**Files:**
- Modify: `Backend/src/agents/agent.router.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `async pick(agents: Agent[], question: string): Promise<{ agentId: string; tokensIn?: number; tokensOut?: number }>` — used by `choose()` and by Task 7's sibling routing.

- [ ] **Step 1: Re-read the current shape**

`choose()` today: loads agents for the account, returns `{ sticky: true }` when the conversation already has one of them, returns the single agent without a model call when there is one, returns the first agent when the provider is unconfigured, otherwise builds the numbered candidate list and asks the model for an ordinal.

- [ ] **Step 2: Move the model half into `pick`**

Keep in `choose()` exactly: the `MAX_CANDIDATES` read, the sticky short-circuit, the single-agent short-circuit, the unconfigured-provider short-circuit, and the `sticky: false` wrapper on the result. Move everything from the candidate-list construction onward into:

```ts
  /**
   * Ask the model which of these agents fits this message. No database, no
   * stickiness: the caller has already decided that a choice is needed, which
   * is why the transfer path can call it with a different candidate set.
   */
  async pick(
    agents: Agent[],
    question: string,
  ): Promise<{ agentId: string; tokensIn?: number; tokensOut?: number }> {
```

The body is the existing candidate-list construction (`MAX_DESCRIPTION`, `MAX_QUESTION`, `this.candidates(...)`, the `chat({ …, temperature: 0, maxTokens: MAX_TOKENS })` call), the `ordinal()` parse, and the fallback to `agents[0].id` when the answer is not a usable ordinal. `choose()` keeps its `if (!this.provider.configured) return { agentId: agents[0].id, sticky: false }` guard so `pick` is only ever reached with a configured provider.

- [ ] **Step 3: Keep `choose()`'s return type unchanged**

```ts
choose(input): Promise<{ agentId: string | null; sticky: boolean; tokensIn?: number; tokensOut?: number }>
```

Every existing caller (`reply.service.ts:261-265`) must compile untouched.

- [ ] **Step 4: Typecheck and build**

Run: `cd Backend; npm run typecheck; npm run build`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add Backend/src/agents/agent.router.ts
git commit -m "refactor(agents): extract AgentRouter.pick from choose"
```

---

### Task 5: `RetrievalService` — separate the embed from the search, add `topScores`

**Files:**
- Modify: `Backend/src/agents/retrieval.service.ts`

**Interfaces:**
- Produces:
  - `embedQuestion(question: string): Promise<{ vector: string; tokens: number }>`
  - `searchByVector(agentId: string, vector: string): Promise<ContextChunk[]>`
  - `topScores(agentIds: string[], vector: string): Promise<Map<string, number>>`
- Consumes: `toVector`, `TOP_K`, `FLOOR` — all unchanged.
- Guarantee: `search(agentId, question)` keeps its exact signature and behaviour, so `agents.service.ask()` is untouched.

- [ ] **Step 1: Split `search()` without changing it**

Replace the body of `search()` with the composition, and add the two helpers it now calls. The existing comment about `SET LOCAL` and the array-form transaction moves into `searchByVector` verbatim — it explains the same code.

```ts
  async search(
    agentId: string,
    question: string,
  ): Promise<{ chunks: ContextChunk[]; embedTokens: number }> {
    const { vector, tokens } = await this.embedQuestion(question);
    const chunks = await this.searchByVector(agentId, vector);

    return { chunks, embedTokens: tokens };
  }

  /** The paid half of a search, exposed so a transfer reuses one embedding. */
  async embedQuestion(question: string): Promise<{ vector: string; tokens: number }> {
    const { vectors, tokens } = await this.provider.embed([question]);

    return { vector: toVector(vectors[0]), tokens };
  }

  /**
   * `SET LOCAL` only applies inside a transaction, and both statements have to
   * share one connection. The array form is one connection and one transaction
   * — unlike the interactive form this codebase avoids on the Supabase pooler.
   */
  async searchByVector(agentId: string, vector: string): Promise<ContextChunk[]> {
    const [, rows] = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(
        "SET LOCAL hnsw.iterative_scan = relaxed_order",
      ),
      this.prisma.$queryRaw<Row[]>`
        SELECT c.id, c.text, s.id AS source_id, s.title,
               1 - (c.embedding <=> ${vector}::vector) AS score
        FROM knowledge_chunks c
        JOIN knowledge_sources s ON s.id = c.source_id
        WHERE s.agent_id = ${agentId}::uuid
          AND s.status = 'READY'
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> ${vector}::vector
        LIMIT ${TOP_K}
      `,
    ]);

    return rows
      .map((row) => ({
        id: row.id,
        text: row.text,
        sourceId: row.source_id,
        title: row.title,
        score: Number(row.score),
      }))
      .filter((row) => row.score >= FLOOR);
  }
```

- [ ] **Step 2: Add `topScores`**

One query, one embedding, every candidate at once. This is why a transfer costs one extra round trip rather than one OpenAI call per candidate.

```ts
  /**
   * The best chunk score each of these agents has for this vector, in one
   * query. `MAX` rather than `ORDER BY … LIMIT 1` per agent because the
   * ranking only needs the top value — the chunks themselves are fetched for
   * one agent, after the decision is made.
   *
   * `s.status::text` is not cosmetic: a parameterised `s.status = $1` is typed
   * `text` and Postgres refuses to compare it to the enum (42883). The cast is
   * the fix, and it is the reason this query cannot be written with Prisma's
   * typed filter.
   */
  async topScores(agentIds: string[], vector: string): Promise<Map<string, number>> {
    if (agentIds.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<
      { agent_id: string; score: number }[]
    >`
      SELECT s.agent_id AS agent_id,
             MAX(1 - (c.embedding <=> ${vector}::vector)) AS score
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON s.id = c.source_id
      WHERE s.agent_id = ANY(${agentIds}::uuid[])
        AND s.status::text = 'READY'
        AND c.embedding IS NOT NULL
      GROUP BY s.agent_id
    `;

    return new Map(rows.map((row) => [row.agent_id, Number(row.score)]));
  }
```

- [ ] **Step 3: Prove the old path is unchanged**

Run: `cd Backend; npm run typecheck; npm run build`
Expected: both exit 0.

Then confirm no other call site changed:

```powershell
Select-String -Path Backend\src -Pattern 'retrieval\.(search|embedQuestion|searchByVector|topScores)\(' -Recurse
```

Expected: `reply.service.ts` calls `search`, `agents.service.ts` calls `search`. Nothing calls the new helpers yet — Task 7 adds those calls.

- [ ] **Step 4: Commit**

```bash
git add Backend/src/agents/retrieval.service.ts
git commit -m "refactor(agents): split retrieval into embed, search and topScores"
```

---

### Task 6: Ownership version — all four conversation writers bump it, takeover stamped before the send

**Files:**
- Modify: `Backend/src/inbox/inbox.service.ts` (`sendText`)
- Modify: `Backend/src/agents/agents.service.ts` (`pause`, `resume`)

**Interfaces:**
- Consumes: `Conversation.aiOwnerVersion` from Task 1.
- Produces: the invariant Task 7 relies on — *any* write that changes who may speak bumps the version in the same `UPDATE`.

Every bump is `aiOwnerVersion: { increment: 1 }` inside the **same `data` object** as the state change. Prisma emits one `UPDATE`; a second statement would let version and state diverge, and the whole guard depends on them never diverging.

- [ ] **Step 1: Move the human takeover stamp above the send in `inbox.service.sendText`**

Current order: `forSending` → `quoteOf` → `sender.text` → `updateMany` that stamps `aiPausedAt`. The stamp therefore lands *after* the human's Graph round trip, leaving the AI's guard blind for up to the sender timeout.

New order — the resolved quote is computed first because it is a read, then the stamp, then the send:

```ts
    const { workspaceId, userId } = await this.workspaces.primaryFor(claims);
    const { conversationId, waId, account } = await this.forSending(workspaceId, id);
    const quote = await this.quoteOf(conversationId, dto.quotedMessageId);

    // A human reply is a takeover, and the stamp goes down *before* the send.
    // Stamping afterwards leaves the AI blind for a whole Graph round trip,
    // which is exactly when it is most likely to answer over the person who is
    // already typing. Two conditions keep it honest: only the first human reply
    // stamps, and only when this number actually has an agent answering —
    // otherwise every thread in a workspace without AI would show a paused
    // badge. A send that then fails still leaves the thread paused, which is
    // the truthful record: a person did decide to take it.
    await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        workspaceId,
        aiPausedAt: null,
        account: { agents: { some: { isActive: true } } },
      },
      data: {
        aiPausedAt: new Date(),
        aiPausedByUserId: userId,
        aiPauseReason: "human",
        aiOwnerVersion: { increment: 1 },
      },
    });

    const message = await this.sender.text({
      workspaceId,
      conversationId,
      waId,
      account,
      body: dto.body,
      quote,
    });

    return { message };
```

If `quoteOf` throws, the thread is not paused and nothing is sent — the request fails as it does today.

- [ ] **Step 2: Bump on `pause`**

In `Backend/src/agents/agents.service.ts`, the `pause` path (the `conversation.updateMany` whose `data` sets `aiPausedAt`, `aiPausedByUserId`, `aiPauseReason`):

```ts
      data: {
        aiPausedAt: new Date(),
        aiPausedByUserId: userId,
        aiPauseReason: reason,
        aiOwnerVersion: { increment: 1 },
      },
```

- [ ] **Step 3: Bump on `resume`**

```ts
      data: {
        aiPausedAt: null,
        aiPausedByUserId: null,
        aiPauseReason: null,
        aiOwnerVersion: { increment: 1 },
      },
```

- [ ] **Step 4: Confirm no other writer was missed**

```powershell
Select-String -Path Backend\src -Pattern 'prisma\.conversation\.update' -Recurse -Context 0,10
```

Expected after this task: six call sites. Four carry `aiOwnerVersion` (this task's two, `reply.service.ts`'s `pause`, and `reply.service.ts`'s bind which Task 7 adds). The remaining two — `inbox.service.update` (`status` + `assignedToUserId`) and the preview writers (`bump`, preview repair, `lastInboundAt`) — deliberately do not bump: they do not change who may speak. `markRead` writes only `unreadCount`.

The one path that cannot bump is `conversations_agent_id_fkey … ON DELETE SET NULL` (migration `0017`): deleting an agent nulls `agent_id` with no application code running. That is exactly why Task 7's guard compares `agentId` itself in addition to the version.

- [ ] **Step 5: Typecheck**

Run: `cd Backend; npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add Backend/src/inbox/inbox.service.ts Backend/src/agents/agents.service.ts
git commit -m "feat(inbox): bump ownership version on every AI control-path write"
```

---

### Task 7: `reply.service.ts` — bind, guard, abort, ledger

**Files:**
- Modify: `Backend/src/agents/reply.service.ts`
- Modify: `Backend/src/inbox/inbox.sender.ts` (the `beforeSend` hook)
- Modify: `Backend/src/agents/agents.module.ts` (only if a provider needs registering — it does not)

**Interfaces:**
- Consumes: `decideTransfer`, `sameSubject`, `OwnerChangedError`, `OwnerCheckError`, `MAX_TRANSFERS`, `FLOOR`, `embedQuestion`, `searchByVector`, `topScores`, `AgentRouter.pick`.
- Produces: run reasons `owner-changed` and `owner-check-failed`; `AgentTransfer` rows for every decision.

- [ ] **Step 1: Add the hook to `InboxSender.text`**

Signature gains one optional field:

```ts
  async text(
    input: SendTarget & {
      body: string;
      quote: Quote | null;
      agentId?: string;
      /**
       * Runs after the row exists and before Meta is called. A rejection — a
       * decision or a database failure — aborts the send: `graph.sendText` is
       * the next statement in the same `try`, so it is never reached. Callers
       * that do not pass one are unaffected.
       */
      beforeSend?: () => Promise<void>;
    },
  ): Promise<MessageView> {
```

and the insert inside the existing `try`, immediately above `const wamid = await this.graph.sendText({`:

```ts
    try {
      if (input.beforeSend) await input.beforeSend();

      const wamid = await this.graph.sendText({
```

No `.catch()`, no `finally`, no `Promise.allSettled` around that call. The existing `catch` at the end of `text()` calls `markFailed` (already `… .catch(() => undefined)`, so it cannot mask the original error) and rethrows through `toHttp` (which returns non-Meta errors unchanged). Keep it exactly as it is.

- [ ] **Step 2: Read `aiOwnerVersion` at the top of `attempt`**

Add `aiOwnerVersion: true,` to the `select` of the `conversation.findUnique` at the top of `attempt()`, then capture the two values the guard needs:

```ts
    const ownerBefore = conversation.agentId;
    const versionBefore = conversation.aiOwnerVersion;
```

- [ ] **Step 3: Replace the swallowing bind with a checked one**

Delete the current block (`if (conversation.agentId !== agent.id) { … .catch(() => undefined) }`) and replace it with:

```ts
    // Bind the thread, but never over another answer's decision: the write is
    // conditional on the owner and version this attempt read, so a concurrent
    // first reply cannot be overwritten by a later one. The version rides in
    // the same UPDATE as the owner, so the two can never disagree.
    //
    // A failed bind is not swallowed any more: if it throws, ownership is
    // unknown and the attempt must not speak.
    let expectedVersion = versionBefore;

    if (ownerBefore !== agent.id) {
      let bound: { count: number };

      try {
        bound = await this.prisma.conversation.updateMany({
          where: { id: conversation.id, agentId: ownerBefore, aiOwnerVersion: versionBefore },
          data: { agentId: agent.id, aiOwnerVersion: { increment: 1 } },
        });
      } catch (error) {
        await this.skip(run.id, "owner-check-failed", { ...routed, latencyMs: Date.now() - started }, sentenceOf(error));
        return;
      }

      if (bound.count === 0) {
        await this.skip(run.id, "owner-changed", { ...routed, latencyMs: Date.now() - started });
        return;
      }

      expectedVersion = versionBefore + 1;
    }
```

`skip()` gains a fourth, optional `note` parameter so this path can record why the check failed without a second write (see step 8).

- [ ] **Step 4: Build the guard**

A private method on `ReplyService`:

```ts
  /**
   * The last thing that happens before a WhatsApp send: re-read who owns this
   * thread and compare. One primary-key read — the join to the agent is an FK
   * lookup — so it costs a single round trip.
   *
   * `isActive` is checked here and not in `pause()`: `deactivate()` writes no
   * conversation row, so no counter can move, and a switched-off agent must not
   * speak. It is deliberately *not* checked by `handoff()`, whose own catch
   * switches the agent off on a revoked key and then still owes the customer a
   * line about a person answering.
   */
  private guard(
    conversationId: string,
    agentId: string,
    expectedVersion: number,
    /** `false` for a handoff: a revoked key still owes the customer one line. */
    checkActive: boolean,
  ): () => Promise<void> {
    return async () => {
      let now: {
        agentId: string | null;
        aiPausedAt: Date | null;
        aiOwnerVersion: number;
        agent: { isActive: boolean } | null;
      } | null;

      try {
        now = await this.prisma.conversation.findUnique({
          where: { id: conversationId },
          select: {
            agentId: true,
            aiPausedAt: true,
            aiOwnerVersion: true,
            agent: { select: { isActive: true } },
          },
        });
      } catch (error) {
        // Fail closed. A guard that cannot run is a guard that said no.
        throw new OwnerCheckError(sentenceOf(error));
      }

      if (!now) throw new OwnerCheckError("The conversation no longer exists.");

      // The version first: it catches A -> B -> A, where the id looks untouched.
      if (now.aiOwnerVersion !== expectedVersion) {
        throw new OwnerChangedError(
          `Ownership moved to version ${now.aiOwnerVersion}, expected ${expectedVersion}.`,
        );
      }

      if (now.agentId !== agentId) {
        throw new OwnerChangedError(`The thread is owned by ${now.agentId ?? "nobody"}.`);
      }

      if (now.aiPausedAt) {
        throw new OwnerChangedError("A person took the thread over.");
      }

      if (checkActive && now.agent && !now.agent.isActive) {
        throw new OwnerChangedError("The agent was switched off.");
      }
    };
  }
```

- [ ] **Step 5: Split the owner's retrieval, and replace the `chunks.length === 0` handoff**

The current retrieval call is:

```ts
      const { chunks, embedTokens } = await this.retrieval.search(agent.id, question);
      spent.embeddingTokens = embedTokens;
```

Replace it with the two halves, so the same vector can be reused by the transfer probe. Behaviour is identical — `search()` was already exactly these two calls in sequence:

```ts
      const embedded = await this.retrieval.embedQuestion(question);
      spent.embeddingTokens = embedded.tokens;

      let chunks = await this.retrieval.searchByVector(agent.id, embedded.vector);
```

The current handoff block is:

```ts
      if (chunks.length === 0) {
        await this.handoff(run.id, conversation.id, target, agent.id, "no-context", { ...spent, latencyMs: Date.now() - started });
        return;
      }
```

Replace it with:

```ts
      // The owner's best score, for the strong-owner gate inside the decision.
      const ownerTop = chunks[0]?.score ?? null;

      // Thin material. Before handing the thread to a person, see whether a
      // sibling on this number knows the subject — once per run, and only when
      // the owner is not comfortably answering on its own.
      if (ownerTop === null || ownerTop < OWNER_STRONG) {
        const chosen = await this.route({
          runId: run.id,
          conversationId: conversation.id,
          workspaceId: conversation.workspaceId,
          accountId: conversation.accountId,
          owner: agent,
          question,
          vector: embedded.vector,
          ownerTop,
          expectedVersion,
          spent,
          started,
          target,
        });

        if (!chosen) return;

        agent = chosen.agent;
        expectedVersion = chosen.expectedVersion;
        chunks = chosen.chunks;
      }
```

Three consequences to get right:
- `chunks` must be `let`, not destructured from a `const`.
- `agent` is already `let`; it now also changes after the model block begins.
- After a transfer, `chunks` are the **new** agent's chunks. `route()` returns them, which is why they are re-fetched there rather than carried over from the owner — the previous agent's material must never be shown to the new one.

- [ ] **Step 6: Add `route()`**

`route()` logs, so the class gains a logger and `Logger` joins the `@nestjs/common` import at the top of the file:

```ts
import { ConflictException, HttpException, Injectable, Logger } from "@nestjs/common";
```

```ts
  private readonly logger = new Logger(ReplyService.name);
```

`MAX_TRANSFERS` is enforced structurally, not by a counter: `route()` is called from exactly one place, which is not a loop, and `attempt()` runs once per run — so a second transfer inside the same attempt cannot happen. Say so in the comment rather than adding a check nobody can reach.

```ts
  /**
   * The transfer decision, in one place. Returns the agent that will answer,
   * or null when the caller must stop — the run already records why.
   *
   * Everything here runs before the model call: the owner's retrieval has
   * already come back thin, one embedding is reused for the owner probe and
   * every candidate, and the decision itself is pure. A ledger row is written
   * on every outcome, refusals included, because "nobody answered" needs a
   * reason in the record.
   */
  private async route(
    input: {
      runId: string;
      conversationId: string;
      workspaceId: string;
      accountId: string;
      owner: Agent;
      question: string;
      /** The embedding the owner's own search already paid for. */
      vector: string;
      /** The owner's best chunk score, or null when nothing cleared FLOOR. */
      ownerTop: number | null;
      expectedVersion: number;
      spent: RunUsage;
      started: number;
      target: SendTarget;
    },
  ): Promise<{
    agent: Agent;
    expectedVersion: number;
    chunks: ContextChunk[];
  } | null> {
    const { runId, conversationId, accountId, owner, question, vector, ownerTop, started, target } = input;
    const usage = (): RunUsage => ({ ...input.spent, latencyMs: Date.now() - started });

    // 1. Candidates: active siblings on this number with at least one READY
    //    source. An agent with no ready material is not a candidate — it would
    //    only produce a second handoff.
    const siblings = await this.prisma.agent.findMany({
      where: {
        whatsappAccountId: accountId,
        isActive: true,
        id: { not: owner.id },
        sources: { some: { status: "READY" } },
      },
      select: { id: true, name: true },
      take: MAX_CANDIDATES,
    });

    const siblingTop = await this.retrieval.topScores(siblings.map((s) => s.id), vector);

    const candidates = siblings
      .map((sibling) => ({
        agentId: sibling.id,
        name: sibling.name,
        score: siblingTop.get(sibling.id) ?? 0,
      }))
      .filter((candidate) => candidate.score >= FLOOR);

    // 3. History: the arrival that put this owner in charge, the previous
    //    customer text, and how many automatic transfers this thread already saw.
    const [lastArrival, previous, recent] = await Promise.all([
      this.prisma.agentTransfer.findFirst({
        where: { conversationId, toAgentId: owner.id },
        orderBy: { createdAt: "desc" },
        select: { fromAgentId: true, toScore: true },
      }),
      this.previousQuestion(conversationId),
      this.prisma.agentTransfer.count({
        where: {
          conversationId,
          trigger: "AUTOMATIC",
          createdAt: { gte: new Date(Date.now() - 86_400_000) },
        },
      }),
    ]);

    const decision = decideTransfer({
      ownerScore: ownerTop,
      candidates,
      last: lastArrival,
      previousQuestion: previous,
      question,
      transfersLast24h: recent,
    });

    if (decision.outcome !== "TRANSFERRED" || !decision.to) {
      this.logger.log(
        `Transfer refused for run ${runId}: ${decision.outcome} — ${decision.note}`,
      );

      await this.prisma.agentTransfer
        .create({
          data: {
            workspaceId: input.workspaceId,
            conversationId,
            runId,
            fromAgentId: owner.id,
            toAgentId: decision.ranked[0]?.agentId ?? owner.id,
            fromScore: ownerTop,
            toScore: decision.ranked[0]?.score ?? null,
            margin: ownerTop !== null && decision.ranked[0]
              ? decision.ranked[0].score - ownerTop
              : null,
            trigger: "AUTOMATIC",
            outcome: decision.outcome,
            candidates: decision.ranked,
          },
        })
        .catch(() => undefined);

      await this.handoff(
        runId, conversationId, target, owner.id, "no-context", usage(),
        undefined,
        this.guard(conversationId, owner.id, input.expectedVersion, false),
      );

      return null;
    }

    // 4. Move the thread. Conditional on the owner and version this attempt
    //    read, exactly like the initial bind — a concurrent assignment wins.
    const next = await this.prisma.agent.findUnique({
      where: { id: decision.to.agentId },
      select: { id: true, isActive: true, model: true, systemPrompt: true, temperature: true, maxReplyChars: true, escalateKeywords: true, name: true },
    });

    if (!next?.isActive) {
      await this.prisma.agentTransfer
        .create({
          data: {
            workspaceId: input.workspaceId,
            conversationId,
            runId,
            fromAgentId: owner.id,
            toAgentId: decision.to.agentId,
            fromScore: ownerTop,
            toScore: decision.to.score,
            margin: ownerTop === null ? null : decision.to.score - ownerTop,
            trigger: "AUTOMATIC",
            outcome: "ABORTED_NO_CANDIDATE",
            candidates: decision.ranked,
          },
        })
        .catch(() => undefined);

      await this.handoff(
        runId, conversationId, target, owner.id, "no-context", usage(),
        undefined,
        this.guard(conversationId, owner.id, input.expectedVersion, false),
      );

      return null;
    }

    // The new owner's material, fetched with the vector we already paid for.
    // A sibling that scored above FLOOR has at least one chunk, so this is
    // normally non-empty — but the answer must be built from this agent's
    // chunks, never the previous agent's. Fetched before the bind on purpose:
    // if it comes back empty we abort without moving the thread.
    const nextChunks = await this.retrieval.searchByVector(next.id, vector);

    if (nextChunks.length === 0) {
      await this.prisma.agentTransfer
        .create({
          data: {
            workspaceId: input.workspaceId,
            conversationId,
            runId,
            fromAgentId: owner.id,
            toAgentId: next.id,
            fromScore: ownerTop,
            toScore: decision.to.score,
            margin: ownerTop === null ? null : decision.to.score - ownerTop,
            trigger: "AUTOMATIC",
            outcome: "ABORTED_NO_CANDIDATE",
            candidates: decision.ranked,
          },
        })
        .catch(() => undefined);

      await this.handoff(
        runId, conversationId, target, owner.id, "no-context", usage(),
        undefined,
        this.guard(conversationId, owner.id, input.expectedVersion, false),
      );

      return null;
    }

    let bound: { count: number };
    try {
      bound = await this.prisma.conversation.updateMany({
        where: { id: conversationId, agentId: owner.id, aiOwnerVersion: input.expectedVersion },
        data: { agentId: next.id, aiOwnerVersion: { increment: 1 } },
      });
    } catch (error) {
      await this.skip(runId, "owner-check-failed", usage(), sentenceOf(error));
      return null;
    }

    if (bound.count === 0) {
      await this.prisma.agentTransfer
        .create({
          data: {
            workspaceId: input.workspaceId,
            conversationId,
            runId,
            fromAgentId: owner.id,
            toAgentId: next.id,
            fromScore: ownerTop,
            toScore: decision.to.score,
            margin: ownerTop === null ? null : decision.to.score - ownerTop,
            trigger: "AUTOMATIC",
            outcome: "ABORTED_OWNER_CHANGED",
            candidates: decision.ranked,
          },
        })
        .catch(() => undefined);

      await this.skip(runId, "owner-changed", usage());
      return null;
    }

    await this.prisma.agentTransfer
      .create({
        data: {
          workspaceId: input.workspaceId,
          conversationId,
          runId,
          fromAgentId: owner.id,
          toAgentId: next.id,
          fromScore: ownerTop,
          toScore: decision.to.score,
          margin: ownerTop === null ? null : decision.to.score - ownerTop,
          trigger: "AUTOMATIC",
          outcome: "TRANSFERRED",
          candidates: decision.ranked,
        },
      })
      .catch(() => undefined);

    await this.prisma.agentRun
      .update({ where: { id: runId }, data: { agentId: next.id } })
      .catch(() => undefined);

    this.logger.log(`Transferred run ${runId}: ${decision.note}`);

    return {
      agent: next as Agent,
      expectedVersion: input.expectedVersion + 1,
      chunks: nextChunks,
    };
  }
```

Imports this step needs at the top of `reply.service.ts`:

```ts
import { FLOOR } from "./retrieval.service";
import type { ContextChunk } from "./retrieval.service";
import {
  decideTransfer,
  MAX_CANDIDATES,
  OWNER_STRONG,
  OwnerChangedError,
  OwnerCheckError,
} from "./agent.transfer";
```

`FLOOR` is already exported by `retrieval.service.ts`; if it is not currently imported into `reply.service.ts`, add it to the existing import rather than adding a second one.

`previousQuestion()` — the customer's inbound `TEXT` immediately before the one being answered, using the existing `@@index([conversationId, createdAt])`:

```ts
  /**
   * The customer's previous inbound text. Deliberately one row, not a window:
   * "did the subject change" is a comparison of two messages, and a longer
   * history would make the same subject match almost anything.
   */
  private async previousQuestion(conversationId: string): Promise<string | null> {
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        direction: "INBOUND",
        kind: "TEXT",
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { body: true },
    });

    // rows[0] is the message being answered; rows[1] is the one before it.
    return rows[1]?.body?.trim() || null;
  }
```

- [ ] **Step 7: Pass the guard to the answer send**

At the answer send:

```ts
      const sent = await this.sender.text({
        ...target,
        body,
        quote: null,
        agentId: agent.id,
        beforeSend: this.guard(conversation.id, agent.id, expectedVersion, true),
      });
```

- [ ] **Step 8: `skip()` records a note**

```ts
  private async skip(
    runId: string,
    reason: string,
    usage: RunUsage = {},
    note?: string,
  ): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: { status: "SKIPPED", reason, ...usage, ...(note ? { error: note } : {}) },
    });
  }
```

- [ ] **Step 9: Handle both abort errors in the catch**

Immediately after the `AiError` usage block and **before** `if (delivered)`, insert:

```ts
      // Ownership moved, or could not be verified, while the model was
      // thinking. Nothing was sent — not the answer and not the handoff line —
      // and the tokens below are what it cost to find out.
      if (error instanceof OwnerChangedError) {
        await this.skip(run.id, "owner-changed", {
          ...spent,
          latencyMs: Date.now() - started,
        }, error.detail);
        return;
      }

      if (error instanceof OwnerCheckError) {
        await this.skip(run.id, "owner-check-failed", {
          ...spent,
          latencyMs: Date.now() - started,
        }, error.detail);
        return;
      }
```

`spent` already holds the router's tokens (line 342), the embedding tokens (355) and the chat tokens (389-390) — all three are captured before any send decision. Do **not** write `skip(run.id, "owner-changed")` without the usage object; a run that paid for an answer reports what it paid.

- [ ] **Step 10: Guard `handoff()` before it pauses**

`handoff()` gains a required sixth parameter, the guard, and runs it *before* `pause()` — pausing first would bump the version the guard expects:

```ts
  private async handoff(
    runId: string,
    conversationId: string,
    target: SendTarget,
    agentId: string,
    reason: string,
    usage: RunUsage = {},
    note?: string,
    guard?: () => Promise<void>,
  ): Promise<void> {
    if (guard) {
      try {
        await guard();
      } catch (error) {
        const aborted =
          error instanceof OwnerChangedError ? "owner-changed" : "owner-check-failed";

        await this.prisma.agentRun
          .update({
            where: { id: runId },
            data: {
              status: "SKIPPED",
              reason: aborted,
              error: sentenceOf(error),
              ...usage,
            },
          })
          .catch(() => undefined);

        return;
      }
    }

    await this.pause(conversationId, reason);
```

The `guard` parameter is optional so the calls added inside `route()` can pass it while any future caller without one still compiles — but every call site in this file must pass it. `handoff()` builds it with `checkActive: false`, so the revoked-key handoff still speaks.

`pause()` bumps the version in its own `UPDATE`:

```ts
      data: {
        aiPausedAt: new Date(),
        aiPauseReason: reason,
        status: "PENDING",
        aiOwnerVersion: { increment: 1 },
      },
```

- [ ] **Step 11: Update the class doc comment**

The reason list at the top of the file gains the two new words, and the `AgentRun.reason` comment in `schema.prisma` (no migration — a comment change only):

```
paused, superseded, window-closed, no-context, no-agent, handoff, unavailable,
owner-changed, owner-check-failed
```

- [ ] **Step 12: Typecheck and build**

Run: `cd Backend; npm run typecheck; npm run build`
Expected: both exit 0. `handoff` now has eight parameters; every existing call inside this file must compile, which it will if the guard is passed.

- [ ] **Step 13: Commit**

```bash
git add Backend/src/agents/reply.service.ts Backend/src/inbox/inbox.sender.ts Backend/prisma/schema.prisma
git commit -m "feat(agents): transfer to a sibling agent with a fail-closed ownership guard"
```

---

### Task 8: `RunView.transfers` — the ledger reaches the Activity tab

**Files:**
- Modify: `Backend/src/agents/agents.service.ts`
- Modify: `frontend/src/features/ai-assistant/types.ts`
- Modify: `frontend/src/features/ai-assistant/components/activity-table.tsx`

**Interfaces:**
- Consumes: `AgentTransfer`, `AgentTransferTrigger`, `AgentTransferOutcome` (Task 1); the run reasons `owner-changed` and `owner-check-failed` (Task 7).
- Produces: `RunView.transfers` on the REST payload and `Run.transfers` in the client types. A run with no transfer carries `[]`, never `undefined` — the table indexes it without a guard.

- [ ] **Step 1: Add the view type and the field**

In `agents.service.ts`, above `export interface RunView`:

```ts
/**
 * One row of the transfer ledger, as the Activity tab reads it. Names travel
 * with the ids because the tab is a record of what happened: an agent can be
 * renamed or deleted afterwards and the row must still say who moved the
 * thread, and to whom.
 */
export interface RunTransferView {
  id: string;
  fromAgent: { id: string; name: string };
  toAgent: { id: string; name: string };
  trigger: AgentTransferTrigger;
  outcome: AgentTransferOutcome;
  fromScore: number | null;
  toScore: number | null;
  createdAt: string;
}
```

and inside `RunView`, directly above `createdAt`:

```ts
  /** Newest first, at most three. Empty for a run that transferred nothing. */
  transfers: RunTransferView[];
```

Add `AgentTransferTrigger` and `AgentTransferOutcome` to the existing `@prisma/client` import at the top of the file. Do not add a second import statement for the same module.

- [ ] **Step 2: One select, used by both queries**

Above `function runView`, at module scope:

```ts
/**
 * The transfer rows a run shows. Three is enough — V1 transfers at most once
 * per run — and the names come back joined so the table needs no second
 * request per row.
 */
const RUN_TRANSFERS = {
  orderBy: { createdAt: "desc" },
  take: 3,
  select: {
    id: true,
    trigger: true,
    outcome: true,
    fromScore: true,
    toScore: true,
    createdAt: true,
    fromAgent: { select: { id: true, name: true } },
    toAgent: { select: { id: true, name: true } },
  },
} satisfies Prisma.AgentRunInclude;
```

`satisfies` rather than a type annotation: it keeps `"desc"` a literal so Prisma's `SortOrder` accepts it, and still fails the build if the shape drifts. Add `Prisma` to the value import from `@prisma/client`.

- [ ] **Step 3: Fetch the relation in both run queries**

Two `agentRun.findMany` calls exist — the twenty-row detail list in `detail()` (`take: 20`) and the paginated list in `runs()` (`take: limit + 1`). Both gain the same line:

```ts
        include: { transfers: RUN_TRANSFERS },
```

Neither query currently passes a `select`, so `include` and the returned scalar fields compose without conflict.

- [ ] **Step 4: Map it in `runView`**

Replace the inline parameter type of `runView` with a named one, and add the mapping to the returned object:

```ts
type RunRow = AgentRun & {
  transfers: {
    id: string;
    trigger: AgentTransferTrigger;
    outcome: AgentTransferOutcome;
    fromScore: number | null;
    toScore: number | null;
    createdAt: Date;
    fromAgent: { id: string; name: string };
    toAgent: { id: string; name: string };
  }[];
};

function runView(row: RunRow): RunView {
```

Inside the returned object, before `createdAt`:

```ts
    transfers: row.transfers.map((transfer) => ({
      id: transfer.id,
      fromAgent: transfer.fromAgent,
      toAgent: transfer.toAgent,
      trigger: transfer.trigger,
      outcome: transfer.outcome,
      fromScore: transfer.fromScore,
      toScore: transfer.toScore,
      createdAt: transfer.createdAt.toISOString(),
    })),
```

`row.transfers` is always an array because both call sites now include it; a `?? []` here would hide the day somebody adds a third call site without the include.

- [ ] **Step 5: Mirror the shape in the client types**

In `frontend/src/features/ai-assistant/types.ts`, above `export interface Run`:

```ts
export type TransferTrigger = "AUTOMATIC" | "MANUAL";

export type TransferOutcome =
  | "TRANSFERRED"
  | "ABORTED_OWNER_STRONG"
  | "ABORTED_NO_CANDIDATE"
  | "ABORTED_MARGIN"
  | "ABORTED_REVERSE"
  | "ABORTED_LIMIT"
  | "ABORTED_OWNER_CHANGED"
  | "ABORTED_SEND_FAILED";

export interface RunTransfer {
  id: string;
  fromAgent: { id: string; name: string };
  toAgent: { id: string; name: string };
  trigger: TransferTrigger;
  outcome: TransferOutcome;
  fromScore: number | null;
  toScore: number | null;
  createdAt: string;
}
```

and inside `Run`, directly above `createdAt`:

```ts
  /** Newest first. Empty when the run transferred nothing. */
  transfers: RunTransfer[];
```

No client file constructs a `Run` literal (checked: only `api.ts` returns the type and `activity-table.tsx` holds it in state), so a required field breaks nothing.

- [ ] **Step 6: Say the two new reasons, and who holds the thread now**

In `components/activity-table.tsx`, add to `REASONS`:

```ts
  "owner-changed": "The thread changed hands mid-reply",
  "owner-check-failed": "Ownership could not be checked, so nothing was sent",
```

Then, inside the `reason` cell — after the `run.reason` block and before the `run.error` block:

```tsx
              {run.transfers[0] ? (
                <span
                  className="block truncate text-xs text-muted-foreground/80"
                  title={`${run.transfers[0].fromAgent.name} → ${run.transfers[0].toAgent.name}`}
                >
                  → {run.transfers[0].toAgent.name}
                </span>
              ) : null}
```

The outcome is deliberately not printed: `TRANSFERRED` is what an arrow already says, and every other outcome leaves the run `SKIPPED`, where the reason above already carries the explanation.

- [ ] **Step 7: Run both gates**

```powershell
cd Backend; npm run typecheck; npm run build
cd ..\frontend; npx tsc --noEmit; npx eslint src --max-warnings=0; npm run build
```

Expected: every command exits 0. A Prisma type error here means `RUN_TRANSFERS` and `include` disagree — fix the select, never cast it.

- [ ] **Step 8: Commit**

```bash
git add Backend/src/agents/agents.service.ts frontend/src/features/ai-assistant/types.ts frontend/src/features/ai-assistant/components/activity-table.tsx
git commit -m "feat(agents): show transfer decisions on the activity tab"
```

---

### Task 9: Deterministic tests — T0 to T7e, and S1 to S4

Every test here is deterministic: no clock, no network, no real database, no randomness. The Prisma fake is a small in-memory database, so the second read in a guard actually sees the first write — which is the only way a test can prove the guard works.

**Files:**
- Modify: `Backend/package.json`
- Modify: `Backend/.gitignore`
- Create: `Backend/tsconfig.test.json`
- Create: `Backend/test/transfer/support/fakes.ts`
- Create: `Backend/test/transfer/support/harness.ts`
- Create: `Backend/test/transfer/decisions.test.ts`
- Create: `Backend/test/transfer/sender-guard.test.ts`
- Create: `Backend/test/transfer/attempt-transfer.test.ts`

**Interfaces:**
- Consumes: `decideTransfer`, `sameSubject`, `OWNER_STRONG`, `TRANSFER_MARGIN`, `REVERSE_MARGIN`, `MAX_TRANSFERS_24H`, `OwnerChangedError`, `OwnerCheckError` (Task 3); `ReplyService.answer`, `InboxSender.text` (Task 7).
- Produces: nothing other modules import. The suite is a gate, not a library.

- [ ] **Step 1: Add the test target**

`Backend/package.json`, in `scripts`, after `typecheck`:

```json
    "test:transfer": "tsc -p tsconfig.test.json && node --test .test-dist/test/transfer/decisions.test.js .test-dist/test/transfer/sender-guard.test.js .test-dist/test/transfer/attempt-transfer.test.js",
```

The `&&` is correct here even on Windows: npm runs a script through `cmd.exe`, not through PowerShell, so `&&` is the separator inside `package.json`. Do not "fix" it to `;`.

`Backend/.gitignore`, under `# Build output`:

```
.test-dist/
```

`Backend/tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": false,
    "incremental": false,
    "rootDir": ".",
    "outDir": ".test-dist"
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Compiling rather than running TypeScript directly is deliberate: it makes the suite independent of Node's experimental decorator transform, and it typechecks the tests as a side effect — the repository's `tsconfig.json` includes `src/**/*.ts` only, so without this file the tests would never be checked at all.

- [ ] **Step 2: Write `support/fakes.ts`**

```ts
/**
 * The fake Prisma is a small in-memory database, not a mock: a handler sees
 * the `where` a write was conditional on and answers with the row count the
 * real UPDATE would have produced. A guard test is only meaningful if the
 * second read sees what the first write did — that is the whole point of
 * `aiOwnerVersion`.
 *
 * Any method a test did not register throws. A forgotten handler then fails
 * the test that needed it, instead of returning `undefined` and looking like
 * a skip.
 *
 * Every call is recorded as an attempt, and `ok` says whether the database
 * accepted it. That distinction is what makes a persistent outage testable:
 * a write that threw is not a record, and an assertion that cannot tell the
 * two apart will happily claim a run was marked when nothing was written.
 */

type Handler = (args: any) => any;

export class FakePrisma {
  /**
   * Every attempt, including the ones that threw. `ok` separates a write the
   * database accepted from one it refused — and in a persistent outage that
   * distinction is the whole test.
   */
  readonly calls: { path: string; args: any; ok: boolean }[] = [];

  private readonly handlers = new Map<string, Handler>();

  on(path: string, handler: Handler): this {
    this.handlers.set(path, handler);
    return this;
  }

  /** Every attempt at `path`, oldest first — including ones that threw. */
  callsTo(path: string): any[] {
    return this.calls.filter((call) => call.path === path).map((call) => call.args);
  }

  /** Every *completed* call to `path`, oldest first. A throw is not a call. */
  completedTo(path: string): any[] {
    return this.calls
      .filter((call) => call.path === path && call.ok)
      .map((call) => call.args);
  }

  /** The `data` of the most recent completed call to `path`, or `undefined`. */
  lastData(path: string): any {
    const done = this.completedTo(path);
    return done.length === 0 ? undefined : done[done.length - 1].data;
  }

  async invoke(path: string, args: any): Promise<any> {
    const call = { path, args, ok: false };
    this.calls.push(call);

    const handler = this.handlers.get(path);

    if (!handler) {
      throw new Error(`FakePrisma: "${path}" was called but no handler was registered.`);
    }

    const result = await handler(args);
    call.ok = true;

    return result;
  }
}

/**
 * `prisma.message.create(...)` becomes `fake.invoke("message.create", ...)`.
 * A Proxy rather than a hand-written class: the client has forty methods per
 * model and the suite needs eleven of them.
 */
export function proxyPrisma(fake: FakePrisma): any {
  return new Proxy(
    {},
    {
      get(_target, model) {
        return new Proxy(
          {},
          {
            get(_inner, method) {
              return (args?: unknown) =>
                fake.invoke(`${String(model)}.${String(method)}`, args);
            },
          },
        );
      },
    },
  );
}

/** The WhatsApp side. `fail` throws instead of recording, like Meta does. */
export class FakeGraph {
  readonly sent: { to: string; body: string }[] = [];

  fail: Error | null = null;

  async sendText(input: { to: string; body: string }): Promise<string> {
    if (this.fail) throw this.fail;

    this.sent.push({ to: input.to, body: input.body });

    return `wamid.${this.sent.length}`;
  }
}

/** The shape `messageView` reads; `createdAt` must be a real Date. */
export function messageRow(id: string, overrides: Record<string, unknown> = {}): any {
  return {
    id,
    wamid: null,
    direction: "OUTBOUND",
    kind: "TEXT",
    agentId: null,
    status: "QUEUED",
    body: "hello",
    templateName: null,
    templateLanguage: null,
    tapTarget: null,
    mediaId: null,
    mediaMime: null,
    mediaName: null,
    mediaSize: null,
    mediaPath: null,
    contextWamid: null,
    errorReason: null,
    payload: null,
    createdAt: new Date("2026-11-26T10:00:00.000Z"),
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    ...overrides,
  };
}
```

- [ ] **Step 3: Write `support/harness.ts`**

The harness builds a **real** `ReplyService` and a **real** `InboxSender` over the fakes. Only the four paid dependencies — router, retrieval, provider, and the cosmetic typing indicator — are stubs, because none of them is what these tests are about.

```ts
import "reflect-metadata";

import { AgentRouter } from "../../../src/agents/agent.router";
import type { OpenAiProvider } from "../../../src/agents/ai.openai";
import { ReplyService, type ClaimedRun } from "../../../src/agents/reply.service";
import type { RetrievalService } from "../../../src/agents/retrieval.service";
import { InboxSender } from "../../../src/inbox/inbox.sender";
import { FakeGraph, FakePrisma, messageRow, proxyPrisma } from "./fakes";

/** What every paid call reports, so a test asserts arithmetic and not "some". */
export const ROUTER_IN = 11;
export const ROUTER_OUT = 2;
export const EMBED_TOKENS = 17;
export const CHAT_IN = 321;
export const CHAT_OUT = 45;

export const OWNER_ID = "11111111-1111-4111-8111-111111111111";
export const NEXT_ID = "22222222-2222-4222-8222-222222222222";
export const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
export const RUN_ID = "55555555-5555-4555-8555-555555555555";
export const WORKSPACE_ID = "66666666-6666-4666-8666-666666666666";
export const ACCOUNT_ID = "77777777-7777-4777-8777-777777777777";
export const INBOUND_ID = "88888888-8888-4888-8888-888888888888";

export const QUESTION = "Do you ship to Canada?";

/** How the send-time ownership read behaves. The first read always succeeds. */
export type GuardFailure = "none" | "changed" | "paused" | "inactive" | "db";

const VECTOR = "[0.1,0.2,0.3]";

function agentRow(id: string, name: string) {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    whatsappAccountId: ACCOUNT_ID,
    name,
    description: null,
    systemPrompt: `You are ${name}.`,
    model: "gpt-4o-mini",
    temperature: 0.2,
    maxReplyChars: 900,
    escalateKeywords: ["refund"],
    isActive: true,
    createdAt: new Date("2026-11-01T09:00:00.000Z"),
    updatedAt: new Date("2026-11-01T09:00:00.000Z"),
  };
}

export const owner = agentRow(OWNER_ID, "Support");
export const next = agentRow(NEXT_ID, "Billing");

export interface HarnessOptions {
  /** What the send-time ownership read reports. */
  guard?: GuardFailure;
  /** The owner's best chunk score. Below `OWNER_STRONG` (0.45) starts a probe. */
  ownerTop?: number | null;
  /** The best sibling score, or `null` when no sibling has ready material. */
  siblingTop?: number | null;
  /** `false` makes the new agent's own search come back empty. */
  nextHasChunks?: boolean;
  /**
   * How the database behaves after the guard's failed read. The difference
   * matters more than it looks:
   *
   * - `"none"` — only the guard's read failed. Every later write succeeds.
   *   The abort is recorded, and the run carries the reason. T7.
   * - `"mark-failed"` — the `FAILED` write to the outbound row fails too, and
   *   the very next statement succeeds. One statement failed; the outage did
   *   not outlast it. T7b.
   * - `"down"` — nothing writes any more, the run's own status included. The
   *   outage outlives the attempt, so **no terminal status can be recorded at
   *   all**. T7c, and limitation 4.
   */
  outage?: "none" | "mark-failed" | "down";
  /** What the customer wrote. Defaults to `QUESTION`. */
  question?: string;
  /** Meta rejects the single message the run sends. */
  sendFails?: boolean;
}

export interface Harness {
  service: ReplyService;
  fake: FakePrisma;
  graph: FakeGraph;
  /** The conversation as the database currently holds it. */
  state: { agentId: string; version: number; pausedAt: Date | null; active: boolean; status: string };
}

export const claimedRun: ClaimedRun = {
  id: RUN_ID,
  workspaceId: WORKSPACE_ID,
  agentId: OWNER_ID,
  conversationId: CONVERSATION_ID,
  inboundMessageId: INBOUND_ID,
};

export function harness(options: HarnessOptions = {}): Harness {
  const guard = options.guard ?? "none";
  const question = options.question ?? QUESTION;
  const ownerTop = options.ownerTop === undefined ? 0.3 : options.ownerTop;
  const siblingTop = options.siblingTop === undefined ? 0.71 : options.siblingTop;
  const nextHasChunks = options.nextHasChunks ?? true;
  const outage = options.outage ?? "none";

  // The simulated row. Every handler below moves this, so a later read sees
  // what an earlier write did — exactly what the guard depends on.
  const state = {
    agentId: OWNER_ID as string,
    version: 7,
    pausedAt: null as Date | null,
    active: true,
    status: "OPEN",
  };

  const fake = new FakePrisma();
  const prisma = proxyPrisma(fake);

  const chunk = (id: string, score: number) => ({
    id,
    text: `${id} text`,
    sourceId: "99999999-9999-4999-8999-999999999999",
    title: "FAQ",
    score,
  });

  fake.on("agentRun.findUnique", () => ({
    id: RUN_ID,
    kind: "REPLY",
    status: "CLAIMED",
    workspaceId: WORKSPACE_ID,
    agentId: OWNER_ID,
    conversationId: CONVERSATION_ID,
    inboundMessageId: INBOUND_ID,
    createdAt: new Date("2026-11-26T10:00:00.000Z"),
    agent: owner,
  }));

  let conversationReads = 0;

  // Latched when the guard's read fails under `outage: "down"`. A real outage
  // is not one statement: once reads start failing, the writes that follow
  // fail too, and the process has nowhere left to record anything.
  let down = false;

  fake.on("conversation.findUnique", () => {
    conversationReads += 1;

    // The first read is the gate at the top of `attempt()`. Every read after
    // it is a guard standing immediately before a send, and the database
    // moves underneath that guard — which is the race these tests exist for.
    if (conversationReads > 1) {
      if (guard === "db") {
        if (outage === "down") down = true;
        throw new Error("connect ETIMEDOUT 10.0.0.5:5432");
      }
      if (guard === "changed") state.version += 1;
      if (guard === "paused") state.pausedAt = new Date("2026-11-26T10:05:00.000Z");
      if (guard === "inactive") state.active = false;
    }

    return {
      id: CONVERSATION_ID,
      workspaceId: WORKSPACE_ID,
      accountId: ACCOUNT_ID,
      agentId: state.agentId,
      aiPausedAt: state.pausedAt,
      aiOwnerVersion: state.version,
      lastInboundAt: new Date(),
      contact: { waId: "15551234567" },
      account: {
        phoneNumberId: "phone-1",
        graphVersion: "v21.0",
        accessTokenCipher: "cipher",
      },
      agent: { isActive: state.active },
    };
  });

  fake.on("conversation.updateMany", ({ where, data }: any) => {
    if (where.agentId !== undefined && where.agentId !== state.agentId) return { count: 0 };
    if (where.aiOwnerVersion !== undefined && where.aiOwnerVersion !== state.version) {
      return { count: 0 };
    }

    if (data.agentId !== undefined) state.agentId = data.agentId;
    if (data.aiOwnerVersion?.increment) state.version += data.aiOwnerVersion.increment;

    return { count: 1 };
  });

  fake.on("conversation.update", ({ data }: any) => {
    if (data.aiOwnerVersion?.increment) state.version += data.aiOwnerVersion.increment;
    if (data.aiPausedAt) state.pausedAt = data.aiPausedAt;
    if (data.status) state.status = data.status;

    return {};
  });

  fake.on("agentRun.count", () => 0);

  fake.on("agentRun.update", () => {
    // The run's own terminal write goes through the same database as
    // everything else. Pretending it cannot fail is how "the run was marked"
    // becomes a claim with no row behind it: here it throws, `skip()` throws,
    // `answer()`'s fallback write throws too, and the row stays CLAIMED.
    if (down) throw new Error("connect ECONNREFUSED 10.0.0.5:5432");

    return {};
  });

  fake.on("message.findUnique", () => ({ body: question }));
  fake.on("message.findMany", () => [
    { body: question },
    { body: "Hi, a question about delivery." },
  ]);
  fake.on("message.create", ({ data }: any) => messageRow("msg-out-1", data));
  fake.on("message.update", ({ where, data }: any) => {
    // Recording the failure is a write like any other: it needs the database.
    if (data.status === "FAILED" && outage !== "none") {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
    }

    if (down) throw new Error("connect ECONNREFUSED 10.0.0.5:5432");

    return messageRow(where.id, data);
  });

  fake.on("agent.findMany", () =>
    siblingTop === null ? [] : [{ id: NEXT_ID, name: next.name }],
  );
  fake.on("agent.findUnique", ({ where }: any) =>
    where.id === NEXT_ID ? { ...next } : { ...owner },
  );

  fake.on("agentTransfer.findFirst", () => null);
  fake.on("agentTransfer.count", () => 0);
  fake.on("agentTransfer.create", ({ data }: any) => ({ id: "transfer-1", ...data }));

  fake.on("businessProfile.findUnique", () => ({ companyName: "Acme" }));

  const retrieval = {
    embedQuestion: async () => ({ vector: VECTOR, tokens: EMBED_TOKENS }),
    searchByVector: async (agentId: string) => {
      if (agentId === OWNER_ID) return ownerTop === null ? [] : [chunk("owner-chunk", ownerTop)];
      return nextHasChunks ? [chunk("next-chunk", siblingTop ?? 0)] : [];
    },
    topScores: async (agentIds: string[]) => new Map(agentIds.map((id) => [id, siblingTop ?? 0])),
  } as unknown as RetrievalService;

  const router = {
    choose: async () => ({
      agentId: OWNER_ID,
      sticky: true,
      tokensIn: ROUTER_IN,
      tokensOut: ROUTER_OUT,
    }),
  } as unknown as AgentRouter;

  const provider = {
    chat: async () => ({
      text: "Yes, we ship to Canada.",
      tokensIn: CHAT_IN,
      tokensOut: CHAT_OUT,
    }),
  } as unknown as OpenAiProvider;

  const graph = new FakeGraph();
  if (options.sendFails) graph.fail = new Error("Meta refused the message");

  const sender = new InboxSender(
    prisma,
    graph as any,
    {} as any,
    { open: () => "token" } as any,
  );

  // Cosmetic and separately tested: the real indicator asks Graph for the
  // newest inbound message, which is not what this suite is about.
  sender.typing = async () => ({ sent: true, reason: null });

  const service = new ReplyService(prisma, sender, retrieval, provider, router);

  return { service, fake, graph, state };
}

/**
 * Every run write the database accepted, oldest first. An attempted write that
 * threw is not a record — that distinction is the whole of T7c.
 */
export function runWrites(fake: FakePrisma): any[] {
  return fake.completedTo("agentRun.update").map((call) => call.data);
}

/** The last run write the database accepted — what the Activity tab shows. */
export function lastRun(fake: FakePrisma): any {
  const writes = runWrites(fake);
  return writes.length === 0 ? undefined : writes[writes.length - 1];
}

/** Every message write the database accepted, oldest first. */
export function messageWrites(fake: FakePrisma): any[] {
  return fake.completedTo("message.update").map((call) => call.data);
}
```

- [ ] **Step 4: Write `decisions.test.ts` — the pure decision, T0 to T4d**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { ConflictException } from "@nestjs/common";

import {
  MAX_TRANSFERS_24H,
  OWNER_STRONG,
  TRANSFER_MARGIN,
  OwnerChangedError,
  OwnerCheckError,
  decideTransfer,
  sameSubject,
  type ScoredAgent,
} from "../../src/agents/agent.transfer";

const billing: ScoredAgent = { agentId: "agent-b", name: "Billing", score: 0.71 };
const shipping: ScoredAgent = { agentId: "agent-c", name: "Shipping", score: 0.62 };

function input(overrides: Partial<Parameters<typeof decideTransfer>[0]> = {}) {
  return {
    ownerScore: 0.3,
    candidates: [billing],
    last: null,
    previousQuestion: null,
    question: "Do you ship to Canada?",
    transfersLast24h: 0,
    ...overrides,
  };
}

test("T0: sameSubject reads two phrasings of one subject as the same subject", () => {
  assert.equal(sameSubject("Do you ship to Canada?", "can you ship to canada"), true);
  assert.equal(sameSubject("Do you ship to Canada?", "Where is my order?"), false);
  // With no evidence of a change, the safe answer is "same".
  assert.equal(sameSubject(null, "anything at all"), true);
});

test("T0b: the two abort errors are distinct, and neither is a ConflictException", () => {
  const changed = new OwnerChangedError("moved");

  assert.equal(changed instanceof OwnerChangedError, true);
  assert.equal(changed instanceof OwnerCheckError, false);
  assert.equal(new OwnerCheckError("db down").detail, "db down");
  // The cause rides in the message, because that is what the FAILED outbound
  // row records.
  assert.match(new OwnerCheckError("db down").message, /db down/);

  // reply.service.ts maps ConflictException to the reason "window-closed", so
  // an abort modelled as one would be filed under the wrong explanation.
  assert.equal(changed instanceof ConflictException, false);
});

test("T1: an owner above OWNER_STRONG keeps the thread, however good the sibling", () => {
  const decision = decideTransfer(input({ ownerScore: OWNER_STRONG + 0.01 }));

  assert.equal(decision.outcome, "ABORTED_OWNER_STRONG");
  assert.equal(decision.to, null);
});

test("T2: an owner with no material hands the thread to the best sibling", () => {
  const decision = decideTransfer(
    input({ ownerScore: null, candidates: [shipping, billing] }),
  );

  assert.equal(decision.outcome, "TRANSFERRED");
  assert.equal(decision.to?.agentId, "agent-b");
  assert.deepEqual(
    decision.ranked.map((candidate) => candidate.agentId),
    ["agent-b", "agent-c"],
  );
});

test("T3: a sibling that does not clear TRANSFER_MARGIN is refused", () => {
  const decision = decideTransfer(
    input({
      ownerScore: 0.3,
      candidates: [{ ...billing, score: 0.3 + TRANSFER_MARGIN - 0.001 }],
    }),
  );

  assert.equal(decision.outcome, "ABORTED_MARGIN");
  assert.equal(decision.to, null);
});

test("T4: returning to the agent we just left is refused on the same subject", () => {
  const decision = decideTransfer(
    input({
      ownerScore: 0.3,
      // 0.44 clears TRANSFER_MARGIN (0.38) but not REVERSE_MARGIN (0.45).
      candidates: [{ ...billing, score: 0.44 }],
      last: { fromAgentId: "agent-b", toScore: 0.72 },
      previousQuestion: "Do you ship to Canada?",
      question: "Do you ship to Canada?",
    }),
  );

  assert.equal(decision.outcome, "ABORTED_REVERSE");
  assert.equal(decision.to, null);
});

test("T4b: returning is allowed once the sibling clears REVERSE_MARGIN", () => {
  const decision = decideTransfer(
    input({
      ownerScore: 0.3,
      candidates: [{ ...billing, score: 0.46 }],
      last: { fromAgentId: "agent-b", toScore: 0.72 },
      previousQuestion: "Do you ship to Canada?",
      question: "Do you ship to Canada?",
    }),
  );

  assert.equal(decision.outcome, "TRANSFERRED");
  assert.equal(decision.to?.agentId, "agent-b");
});

test("T4c: a new subject plus owner drift allows the return", () => {
  const decision = decideTransfer(
    input({
      ownerScore: 0.3,
      candidates: [{ ...billing, score: 0.4 }],
      last: { fromAgentId: "agent-b", toScore: 0.72 },
      previousQuestion: "Where is my order?",
      question: "Can I get a refund for the annual plan?",
    }),
  );

  assert.equal(decision.outcome, "TRANSFERRED");
  assert.equal(decision.to?.agentId, "agent-b");
});

test("T4d: six automatic transfers in 24h stop the chain", () => {
  const decision = decideTransfer(input({ transfersLast24h: MAX_TRANSFERS_24H }));

  assert.equal(decision.outcome, "ABORTED_LIMIT");
  assert.equal(decision.to, null);
});
```

Run it alone to prove the pure half is green before touching the pipeline:

```powershell
cd Backend; npx tsc -p tsconfig.test.json; node --test .test-dist/test/transfer/decisions.test.js
```

Expected: `# pass 9`, `# fail 0`.

- [ ] **Step 5: Write `sender-guard.test.ts` — S1 to S4**

This file tests `InboxSender` **alone**. It is where the fail-closed property is proved as an execution path: the hook is awaited inside the same `try` as `graph.sendText`, so a rejection makes the call to Meta unreachable — not merely skipped by convention.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { InboxSender } from "../../src/inbox/inbox.sender";
import { FakeGraph, FakePrisma, messageRow, proxyPrisma } from "./support/fakes";
import { CONVERSATION_ID, WORKSPACE_ID } from "./support/harness";

function build(markFailedFails = false) {
  const fake = new FakePrisma();

  fake.on("message.create", ({ data }: any) => messageRow("msg-1", data));
  fake.on("message.update", ({ where, data }: any) => {
    if (data.status === "FAILED" && markFailedFails) throw new Error("connection lost");

    return messageRow(where.id, data);
  });
  fake.on("conversation.update", () => ({}));

  const graph = new FakeGraph();
  const instance = new InboxSender(proxyPrisma(fake), graph as any, {} as any, {
    open: () => "token",
  } as any);

  return { fake, graph, instance };
}

const target = {
  workspaceId: WORKSPACE_ID,
  conversationId: CONVERSATION_ID,
  waId: "15551234567",
  account: {
    phoneNumberId: "phone-1",
    graphVersion: "v21.0",
    accessTokenCipher: "cipher",
  },
};

test("S1: a rejecting beforeSend stops the send, fails the row and rethrows the original error", async () => {
  const { fake, graph, instance } = build();
  const abort = new Error("ownership could not be verified");

  await assert.rejects(
    instance.text({
      ...target,
      body: "hi",
      quote: null,
      beforeSend: async () => {
        throw abort;
      },
    }),
    (error) => error === abort,
  );

  assert.equal(graph.sent.length, 0);
  assert.equal(fake.lastData("message.update").status, "FAILED");
  assert.match(fake.lastData("message.update").errorReason, /ownership could not be verified/);
});

test("S2: a passing beforeSend lets the send through, once", async () => {
  const { fake, graph, instance } = build();
  let ran = 0;

  const view = await instance.text({
    ...target,
    body: "hi",
    quote: null,
    beforeSend: async () => {
      ran += 1;
    },
  });

  assert.equal(ran, 1);
  assert.equal(graph.sent.length, 1);
  assert.equal(graph.sent[0]?.body, "hi");
  assert.equal(view.status, "SENT");
  assert.equal(fake.callsTo("message.update").length, 1);
});

test("S3: a caller that passes no hook behaves exactly as it did before", async () => {
  const { graph, instance } = build();

  const view = await instance.text({ ...target, body: "hi", quote: null });

  assert.equal(graph.sent.length, 1);
  assert.equal(view.status, "SENT");
});

test("S4: when the failure cannot be recorded either, the original error is still what is thrown", async () => {
  const { graph, instance } = build(true);
  const abort = new Error("database is gone");

  await assert.rejects(
    instance.text({
      ...target,
      body: "hi",
      quote: null,
      beforeSend: async () => {
        throw abort;
      },
    }),
    (error) => error === abort,
  );

  assert.equal(graph.sent.length, 0);
});
```

S4 is the test that pins `markFailed`'s `.catch(() => undefined)`: a database that cannot record the failure must not replace the reason the send was refused.

```powershell
cd Backend; npx tsc -p tsconfig.test.json; node --test .test-dist/test/transfer/sender-guard.test.js
```

Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 6: Write `attempt-transfer.test.ts` — T5 to T7e**

Every test here drives the real `ReplyService.answer()` through the real `InboxSender` and asserts on the rows the simulated database received. `harness()` starts with the owner holding the thread at version 7 and a sibling one transfer away.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { HANDOFF_MESSAGE } from "../../src/agents/reply.prompt";
import {
  CHAT_IN,
  CHAT_OUT,
  EMBED_TOKENS,
  NEXT_ID,
  OWNER_ID,
  ROUTER_IN,
  ROUTER_OUT,
  claimedRun,
  harness,
  lastRun,
  messageWrites,
  runWrites,
} from "./support/harness";

test("T5: a thin owner transfers the thread, answers as the new agent, and records both", async () => {
  const h = harness({ ownerTop: 0.3, siblingTop: 0.71 });

  await h.service.answer(claimedRun);

  // The thread really moved, in one conditional write.
  assert.equal(h.state.agentId, NEXT_ID);
  assert.equal(h.state.version, 8);

  // The ledger says why it moved.
  const transfer = h.fake.lastData("agentTransfer.create");
  assert.equal(transfer.outcome, "TRANSFERRED");
  assert.equal(transfer.fromAgentId, OWNER_ID);
  assert.equal(transfer.toAgentId, NEXT_ID);
  assert.equal(transfer.fromScore, 0.3);
  assert.equal(transfer.toScore, 0.71);

  // The answer is the new agent's — bubble badge and all.
  assert.equal(h.graph.sent.length, 1);
  assert.equal(h.graph.sent[0]?.body, "Yes, we ship to Canada.");
  assert.equal(h.fake.lastData("message.create").agentId, NEXT_ID);

  // The run records who answered, and everything the attempt cost.
  assert.deepEqual(
    h.fake.callsTo("agentRun.update").map((call: any) => call.data.agentId).filter(Boolean),
    [NEXT_ID],
  );

  const run = lastRun(h.fake);
  assert.equal(run.status, "SENT");
  assert.equal(run.outboundMessageId, "msg-out-1");
  assert.equal(run.tokensIn, ROUTER_IN + CHAT_IN);
  assert.equal(run.tokensOut, ROUTER_OUT + CHAT_OUT);
  assert.equal(run.embeddingTokens, EMBED_TOKENS);
  assert.equal(typeof run.latencyMs, "number");
});

test("T5b: a strong owner never even looks for a sibling", async () => {
  const h = harness({ ownerTop: 0.6 });

  await h.service.answer(claimedRun);

  assert.equal(h.fake.callsTo("agent.findMany").length, 0);
  assert.equal(h.fake.callsTo("agentTransfer.create").length, 0);

  assert.equal(h.state.agentId, OWNER_ID);
  assert.equal(h.graph.sent.length, 1);

  const run = lastRun(h.fake);
  assert.equal(run.status, "SENT");
  assert.equal(run.tokensIn, ROUTER_IN + CHAT_IN);
});

test("T6: with no eligible sibling the thread goes to a person, not to a second agent", async () => {
  const h = harness({ ownerTop: 0.2, siblingTop: null });

  await h.service.answer(claimedRun);

  // The ledger records the refusal, because that is the answer to "why did
  // nobody reply".
  const transfer = h.fake.lastData("agentTransfer.create");
  assert.equal(transfer.outcome, "ABORTED_NO_CANDIDATE");
  assert.equal(transfer.fromAgentId, OWNER_ID);

  // The thread stays put and becomes a person's work.
  assert.equal(h.state.agentId, OWNER_ID);
  assert.notEqual(h.state.pausedAt, null);
  assert.equal(h.state.status, "PENDING");
  // The pause bumped the version, so a guard still holding 7 cannot pass.
  assert.equal(h.state.version, 8);

  assert.equal(h.graph.sent.length, 1);
  assert.equal(h.graph.sent[0]?.body, HANDOFF_MESSAGE);

  const run = lastRun(h.fake);
  assert.equal(run.status, "SKIPPED");
  assert.equal(run.reason, "no-context");
  assert.equal(run.outboundMessageId, "msg-out-1");
  assert.equal(run.tokensIn, ROUTER_IN);
  assert.equal(run.tokensOut, ROUTER_OUT);
  assert.equal(run.embeddingTokens, EMBED_TOKENS);
});

test("T6b: a sibling whose own search comes back empty is never bound", async () => {
  const h = harness({ ownerTop: 0.3, siblingTop: 0.71, nextHasChunks: false });

  await h.service.answer(claimedRun);

  // Nothing moved: the chunks were fetched before the bind, on purpose.
  assert.equal(h.fake.callsTo("conversation.updateMany").length, 0);
  assert.equal(h.state.agentId, OWNER_ID);

  assert.equal(h.fake.lastData("agentTransfer.create").outcome, "ABORTED_NO_CANDIDATE");
  assert.equal(h.graph.sent.length, 1);
  assert.equal(h.graph.sent[0]?.body, HANDOFF_MESSAGE);
  assert.equal(lastRun(h.fake).reason, "no-context");
});

test("T6c: when even the handoff line cannot be sent, the run still records why", async () => {
  const h = harness({ ownerTop: 0.2, siblingTop: null, sendFails: true });

  await h.service.answer(claimedRun);

  const run = lastRun(h.fake);
  assert.equal(run.status, "SKIPPED");
  assert.equal(run.reason, "no-context");
  assert.match(run.error, /Meta refused the message/);
  assert.equal(run.outboundMessageId, undefined);
  assert.equal(run.embeddingTokens, EMBED_TOKENS);
});

test("T6d: an escalation keyword hands off before anything is embedded", async () => {
  const h = harness({ question: "I need a refund for the annual plan" });

  await h.service.answer(claimedRun);

  assert.notEqual(h.state.pausedAt, null);
  assert.equal(h.graph.sent.length, 1);
  assert.equal(h.graph.sent[0]?.body, HANDOFF_MESSAGE);

  const run = lastRun(h.fake);
  assert.equal(run.status, "SKIPPED");
  assert.equal(run.reason, "handoff");
  assert.equal(run.tokensIn, ROUTER_IN);
  // Nothing was embedded, so nothing claims to have been.
  assert.equal(run.embeddingTokens, undefined);
});

test("T7: a database failure at the final ownership check sends nothing, and still records what it cost", async () => {
  const h = harness({ ownerTop: 0.3, siblingTop: 0.71, guard: "db" });

  await h.service.answer(claimedRun);

  // 1. The customer's thread receives nothing at all — not the answer, and
  //    not the fixed handoff line either. Fail closed.
  assert.equal(h.graph.sent.length, 0);
  assert.equal(h.graph.sent.filter((message) => message.body === HANDOFF_MESSAGE).length, 0);

  // 2. The run says what happened and why, and does not pretend to have sent.
  const run = lastRun(h.fake);
  assert.equal(run.status, "SKIPPED");
  assert.equal(run.reason, "owner-check-failed");
  assert.match(run.error, /ETIMEDOUT/);
  assert.equal(run.outboundMessageId, undefined);

  // 3. Every paid call is still recorded: routing, embedding, and chat. These
  //    are token counts for the Usage aggregate and the Activity tab — a cost
  //    record, not a charge to the customer — see "What recorded means, and
  //    what it does not", below.
  assert.equal(run.tokensIn, ROUTER_IN + CHAT_IN);
  assert.equal(run.tokensOut, ROUTER_OUT + CHAT_OUT);
  assert.equal(run.embeddingTokens, EMBED_TOKENS);
  assert.equal(typeof run.latencyMs, "number");

  // 4. The outbound row is FAILED, because the database that refused the
  //    guard was reachable again a moment later.
  const failed = messageWrites(h.fake).filter((write: any) => write.status === "FAILED");
  assert.equal(failed.length, 1);
  assert.match(failed[0].errorReason, /ETIMEDOUT/);

  // 5. The transfer that already happened stands — the abort is about
  //    speaking, not about undoing a bind.
  assert.equal(h.state.agentId, NEXT_ID);
  assert.equal(h.state.version, 8);
});

test("T7b: a transient failure to record the abort loses the row but not the run", async () => {
  const h = harness({
    ownerTop: 0.3,
    siblingTop: 0.71,
    guard: "db",
    outage: "mark-failed",
  });

  await h.service.answer(claimedRun);

  // One failed statement is not a licence to speak: still fail closed.
  assert.equal(h.graph.sent.length, 0);

  // The FAILED write to the outbound row was attempted and refused. The row
  // keeps the status its insert gave it — `QUEUED` — and nothing completed
  // says otherwise.
  const attempted = h.fake
    .callsTo("message.update")
    .filter((call: any) => call.data.status === "FAILED");
  assert.equal(attempted.length, 1);
  assert.equal(
    messageWrites(h.fake).filter((write: any) => write.status === "FAILED").length,
    0,
  );

  // The outage did not outlast `markFailed`: the very next write went through,
  // so the run carries the abort and what it cost. `.catch(() => undefined)`
  // is what buys this — a bookkeeping failure never replaces the reason
  // nothing was sent.
  const run = lastRun(h.fake);
  assert.equal(run.status, "SKIPPED");
  assert.equal(run.reason, "owner-check-failed");
  assert.match(run.error, /ETIMEDOUT/);
  assert.equal(run.outboundMessageId, undefined);
  assert.equal(run.tokensIn, ROUTER_IN + CHAT_IN);
  assert.equal(run.tokensOut, ROUTER_OUT + CHAT_OUT);
  assert.equal(run.embeddingTokens, EMBED_TOKENS);
});

test("T7c: a persistent outage records neither the outbound row nor the run", async () => {
  const h = harness({
    ownerTop: 0.3,
    siblingTop: 0.71,
    guard: "db",
    outage: "down",
  });

  await h.service.answer(claimedRun);

  // Fail closed, and stay closed: nothing reaches Meta.
  assert.equal(h.graph.sent.length, 0);

  // Every terminal record is itself a write, on the same dead connection:
  // `markFailed` for the row, `skip()` for the run, `answer()`'s fallback for
  // the run again. None of them landed.
  assert.equal(
    messageWrites(h.fake).filter((write: any) => write.status === "FAILED").length,
    0,
  );
  const refused = h.fake.calls
    .filter((call) => call.path === "agentRun.update" && !call.ok)
    .map((call) => call.args.data.status);
  assert.deepEqual(refused, ["SKIPPED", "FAILED"]);

  // So the run has no terminal status at all — only the transfer's own
  // `agentId`, written before the outage began. Claiming otherwise would be a
  // claim with no row behind it; recovery is the stale sweep, not this code.
  assert.equal(runWrites(h.fake).filter((write: any) => write.status !== undefined).length, 0);
  assert.deepEqual(
    runWrites(h.fake).map((write: any) => write.agentId).filter(Boolean),
    [NEXT_ID],
  );

  // `answer()` never throws, so the scheduled runner keeps ticking.
  assert.equal(h.state.agentId, NEXT_ID);
  assert.equal(h.state.version, 8);
});

test("T7d: a person taking the thread over during the model call wins", async () => {
  const h = harness({ ownerTop: 0.3, siblingTop: 0.71, guard: "paused" });

  await h.service.answer(claimedRun);

  assert.equal(h.graph.sent.length, 0);
  assert.equal(h.graph.sent.filter((message) => message.body === HANDOFF_MESSAGE).length, 0);

  const run = lastRun(h.fake);
  assert.equal(run.status, "SKIPPED");
  assert.equal(run.reason, "owner-changed");
  assert.equal(run.tokensIn, ROUTER_IN + CHAT_IN);
  assert.equal(run.embeddingTokens, EMBED_TOKENS);
});

test("T7e: an agent switched off while answering does not speak", async () => {
  const h = harness({ ownerTop: 0.6, guard: "inactive" });

  await h.service.answer(claimedRun);

  assert.equal(h.graph.sent.length, 0);

  const run = lastRun(h.fake);
  assert.equal(run.status, "SKIPPED");
  assert.equal(run.reason, "owner-changed");
  assert.match(run.error, /switched off/);
});
```

Why T7e matters: `deactivate()` writes only `Agent.isActive`. No conversation row changes, so no version can be bumped — which is exactly why the guard joins the agent instead of trusting the counter.

- [ ] **Step 7: Run the whole suite**

```powershell
cd Backend; npm run test:transfer
```

Expected: `# pass 24`, `# fail 0`. The count is 9 in `decisions`, 4 in `sender-guard`, 11 in `attempt-transfer`.

If a test fails, fix the **implementation**, not the assertion. The one exception is an arithmetic mistake in a constant: `OWNER_STRONG`, `TRANSFER_MARGIN` and `REVERSE_MARGIN` are asserted through the decision's outcome, so a wrong constant shows up as a wrong outcome, not as a wrong number.

- [ ] **Step 8: Prove nothing else broke**

```powershell
cd Backend; npm run typecheck; npm run build; npx prisma validate
```

Expected: all three exit 0. `npm run build` excludes `**/*.test.ts` already, so no test file can reach `dist`.

- [ ] **Step 9: Commit**

```bash
git add Backend/package.json Backend/.gitignore Backend/tsconfig.test.json Backend/test/transfer
git commit -m "test(agents): cover transfer decisions and the fail-closed send guard"
```

---

### Task 10: Verification — prove the work, and prove the schema never left this machine

**Files:** none. This task changes no file; it produces evidence.

- [ ] **Step 1: Do not touch the database**

This task runs **no** `prisma migrate` subcommand, in any form. `migrate dev` is disqualified by R-10, `migrate deploy` applies DDL to production, and even `migrate status` is a connection to the live database that this plan's scope does not need. Whether `0021_agent_transfers` is applied is a deployment decision made by a person, later.

The migration's safety is proven by inspection instead, in Task 2. Re-run that inspection as the last check:

```powershell
Select-String -Path Backend\prisma\migrations\0021_agent_transfers\migration.sql -Pattern 'DROP|ALTER COLUMN|knowledge_chunks|DELETE FROM|TRUNCATE'
```

Expected: no output. Every statement is `CREATE TABLE`, `CREATE TYPE`, `CREATE INDEX`, or `ALTER TABLE … ADD COLUMN` / `ADD CONSTRAINT`.

- [ ] **Step 2: Run every gate**

```powershell
cd Backend; npm run typecheck; npm run build; npx prisma validate; npm run test:transfer
cd ..\frontend; npx tsc --noEmit; npx eslint src --max-warnings=0; npm run build
```

Expected: seven commands, all exit 0, and `# fail 0` from the suite.

- [ ] **Step 3: Read the diff you are about to be judged on**

```powershell
git log --oneline -11
git diff --stat HEAD~10
```

Expected: ten conventional commits, one per task. The stat lists only the files in the File map, plus `Backend/test/transfer/**`, `Backend/tsconfig.test.json`, `Backend/package.json` and `Backend/.gitignore`. If `Backend/prisma/migrations/` shows anything other than the new `0021_agent_transfers` folder, stop and look — an edited historical migration is a deployment hazard.

- [ ] **Step 4: Confirm the tree is clean**

```powershell
git status --short
```

Expected: no output. `.test-dist/` must not appear; if it does, `Backend/.gitignore` was not saved correctly.

## Coverage

Every behaviour this plan claims, and the artefact that proves it.

| Behaviour | Implemented in | Proven by |
|---|---|---|
| One conditional write moves the thread | `reply.service.ts` `route()` bind, and the initial bind in `attempt()` | T5 (`version` 7 → 8, `agentId` moves once) |
| A strong owner is never examined | `OWNER_STRONG` gate before `route()` | T5b (`agent.findMany` never called) |
| A sibling must beat the owner by `TRANSFER_MARGIN` | `decideTransfer` | T3 |
| Going back needs `REVERSE_MARGIN` or a new subject plus drift | `decideTransfer` + `sameSubject` | T4, T4b, T4c, T0 |
| The 24-hour fuse stops a loop | `MAX_TRANSFERS_24H` | T4d |
| Only agents with a `READY` source are candidates | `route()` candidate query | T6 (no sibling → handoff, not a second agent) |
| A sibling with no material is never bound | `nextChunks` fetched before the bind | T6b |
| A refusal is recorded with its reason | `agentTransfer.create` on every branch | T5, T6, T6b |
| Silence is explained on the Activity tab | `RunView.transfers`, `REASONS` | Task 8 gates |
| Ownership is revalidated immediately before the send | `sender.text` `beforeSend` hook + `guard()` | S1, S2, T7d, T7e |
| A failed ownership check fails closed | the hook is awaited inside the same `try` as `graph.sendText` | S1, S4, T7, T7b, T7c |
| The abort does not become a handoff | `OwnerChangedError` / `OwnerCheckError` are not `ConflictException` | T0b, T7, T7d |
| Tokens survive a rejected send | `spent` captured before any send decision | T7, T7b, T7d, T6d |
| A refused bookkeeping write does not replace the reason | `markFailed` ends `.catch(() => undefined)`; `skip()` still runs | T7b |
| A persistent outage records nothing, and is recovered by the sweep | `releaseStale()` in `agents.runner.ts` — not by this plan | T7c, limitation 4 |
| A guard that cannot run never sends | `OwnerCheckError` thrown from the `catch` around the guard's read | T7 |
| Inbox behaviour is unchanged for every other caller | optional `beforeSend` | S3 |

### What "recorded" means, and what it does not

A run's token columns are a **cost record, not a charge**. `AgentRun.tokensIn`,
`tokensOut` and `embeddingTokens` hold the counts the providers reported for this
attempt — router, embedding, chat — and they feed the Usage aggregate and the
Activity tab. Nothing here bills a customer, and this plan touches no billing
code at all: WhatsApp conversation charges are Meta's, billed to the WABA owner
on Meta's own cycle, and the only billing-relevant decision this plan makes is
whether a message is sent. So "the run still records what it cost" means exactly
one thing: the three columns hold real counts from calls that really happened,
which keeps the cost of a failed attempt visible. It does not mean the attempt
succeeded, and it does not mean anyone was charged.

The same precision applies to the outbound row. `Message.status = FAILED` with a
`errorReason` is a record that Meta was never called — but only if the write
reached the database. T7 covers the case where it did, T7b where it did not while
the run's own write still succeeded, and T7c where neither could be written at all,
leaving the run `CLAIMED` and the row `QUEUED` until recovery.

## Known limitations, accepted in V1

Read these before deploying. Each one is a decision, not an oversight.

1. **The send still has a gap.** The guard reads ownership, returns, and only then does `graph.sendText` reach Meta. A reassignment landing inside that gap is not detected — see R-8. Closing it would need a row lock or an outbox held across a network call, and Meta offers no idempotency key to make a retry safe. The gap is single-digit milliseconds, and the alternative costs the pooler a pinned connection for the duration of a WhatsApp call.
2. **The handoff line is guarded before `pause()`, not at the send.** R-6: pausing bumps the version the guard expects, so the guard has to run first. A human takeover in the pause→send gap can still receive one fixed sentence. It is one line, it says a person will follow, and it is the failure mode that is cheapest to be wrong about.
3. **A deliberate abort leaves a `FAILED` outbound row.** R-9: `MessageStatus` has no "not sent on purpose" state, and adding one would touch the status rank and the tick UI. The row's `errorReason` carries the real cause, and the run carries the real reason, so nothing is lost — but a naive "failed deliveries" count includes them.
4. **An outage that outlives the attempt records nothing; recovery is the stale sweep, not this plan.** Every terminal record is itself a database write — `markFailed` for the outbound row, `skip()` for the run, and `answer()`'s fallback for the run again. Two cases, and they behave differently:
   - **Transient (T7b):** the `FAILED` write is refused, the database recovers for the next statement, and the run records `SKIPPED` / `owner-check-failed` with its token counts. Only the outbound row is left `QUEUED`; there is no sweeper for outbound messages in this codebase, and this plan does not add one.
   - **Persistent (T7c):** nothing is written at all. The run stays `CLAIMED` and the outbound row keeps the status its insert gave it. Claiming the run was marked would be a claim with no row behind it, so the plan does not make it. Recovery is the pre-existing sweep: `agents.runner.ts` calls `releaseStale()` on every tick, which requeues a `CLAIMED` run older than `STALE_MS` (ten minutes) and marks it `FAILED` once `attempts >= MAX_ATTEMPTS`. The retry is safe because the guard refused the send, so the customer received nothing and will not receive it twice. Two costs are accepted: the reply is late by up to the stale window plus one tick, and the orphaned `QUEUED` row stays in the thread until someone looks at it.
5. **Chunk-count bias is real.** An agent with 400 chunks out-scores an agent with 3 for the same question, because the top-k maximum grows with the corpus. V1 accepts it (Global Constraints) and writes every score to `agent_transfers` so a later calibration pass can see what was rejected.
6. **Thresholds are blunt and uncalibrated.** `OWNER_STRONG 0.45`, `TRANSFER_MARGIN 0.08`, `REVERSE_MARGIN 0.15`, `REVERSE_DRIFT 0.10` and `SAME_SUBJECT 0.50` were chosen for conservatism, not fitted to data. `agent_transfers` exists so they can be fitted later without a migration.
7. **`MANUAL` transfers have no writer.** The enum value and the reverse guard that reads it exist; the assignment endpoint that would write it does not. Adding it later needs no migration.
8. **One transfer per run, six per thread per day.** A chain of three voices is not a conversation, and `MAX_TRANSFERS_24H` is a fuse rather than a throttle.
9. **No send idempotency.** `inboundMessageId @unique` remains the only run-level dedupe; outbound duplicate protection is a separate task and is not solved here.
10. **Nothing in this plan is deployed.** The migration folder is committed, not applied. `start:prod` runs `prisma migrate deploy`, so merging to the deployed branch applies it on the next boot — which is why Task 2's inspection gate matters more than usual.

## What this plan deliberately does not do

- It does not apply `0021_agent_transfers`, and it does not run any `prisma migrate` command.
- It does not change an environment variable, a Render service, or a Vercel project.
- It does not deploy.
- It does not modify `0017_conversation_agent` or any other applied migration.
- It does not add a dependency, a queue, a Redis, or a second background loop.
- It does not change `TOP_K`, `FLOOR`, the embedding dimension, or the retrieval SQL that already serves `agents.service.ask()`.
- It does not resume an AI-paused conversation. No code path in this plan clears `aiPausedAt`.
