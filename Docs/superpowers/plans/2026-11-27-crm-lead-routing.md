# CRM lead routing + member profiles — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every conversation a lead stage decided locally, hand new interested leads to the right team member by rotation, create and track follow-up tasks, and let the owner fill in each member's designation and personal WhatsApp number.

**Architecture:** One hand-written Prisma migration adds two enums and two tables at the end of a new `Backend/src/crm/` module. A pure rule engine (`interest.rules.ts`) classifies the customer's words with no I/O; `lead.intake.ts` runs beside the existing AI intake, right after `InboxStore.record()`, and writes the stage, mirrors it onto `Contact.tags`, rotates the lead through `round.robin.ts` and creates one open task. The inbox reads the stage and the open task from the selection it already makes, so the queue gains two fields, not a second request.

**Tech Stack:** NestJS 11, Prisma 6.19.3 on Supabase Postgres, `node:test` + `node:assert/strict` with a stubbed Prisma, Next.js 16 App Router (client components for the new screens), Tailwind with the existing design tokens.

**Spec:** `Docs/superpowers/specs/2026-11-27-crm-lead-routing-design.md`

## Global Constraints

- **Do not commit, do not push, do not deploy.** Every task ends with a verification checkpoint, never a `git commit`.
- **Never run `prisma migrate dev`, `prisma db push` or `prisma migrate deploy`.** The migration is authored as SQL and applied by the owner at deploy time (`prisma migrate deploy` runs from `start:prod`). `npx prisma validate` and `npx prisma generate` are the only Prisma commands this plan runs.
- **No interactive `$transaction`.** The runtime URL goes through Supabase's transaction pooler, which cannot carry one. Every write is individually idempotent instead.
- **Every query is scoped by the `workspaceId` from `WorkspacesService.primaryFor(claims)`.** A workspace id or user id from a request body is never trusted as a tenant scope.
- **New backend tests** are `node:test` + `node:assert/strict`, in a `*.test.ts` file beside the source they cover, with Prisma stubbed the way `Backend/src/inbox/inbox.queue.test.ts` does it.
- **Backend gates:** `npm run typecheck` (`tsc -p tsconfig.json --noEmit`), `npm test` (`tsc -p tsconfig.test.json` then `node --test .test-dist/**/*.test.js`), `npx nest build`.
- **Frontend gates:** `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `npm run build`.
- **PowerShell:** separate statements with `;`, never `&&`.
- Copy these strings exactly: module key `crm`; routes `/v1/crm/pipeline`, `/v1/crm/conversations/:id/interest`, `/v1/crm/tasks`, `/v1/crm/tasks/:id`, `/v1/crm/tasks/:id/wa-link`, `/v1/crm/settings`, `/v1/workspaces/members/:userId/profile`; error codes `NO_PERSONAL_NUMBER`, `TASK_NOT_YOURS`, `SCOPE_FORBIDDEN`, `MEMBER_MISSING`; contact tags `interested`, `not-interested`; manual reason `manual`.
- Column names are snake_case and table names are the `@@map` values, because the migration is written by hand.

## Rulings this plan fixes

The spec is the authority; these three points were fixed while turning it into steps, and each is a deliberate, visible change rather than a silent one.

1. **The classifier scores per message, not cumulatively.** The spec's sticky rules ("a `STOP` clears only on a `BUYING` match", "a short reply borrows the previous score") only behave as written when the stored score is the evidence of the deciding message. `interestScore` keeps that evidence; `interestReason` names the profile, so a later threshold change is still visible in the data.
2. **The `wa.me` text leaves out the task note.** The note is the internal classifier reason (`Interested: matched "how much" (BUYING)`); pasting it into a customer's chat is a copy bug, not a feature. The message names the business, the agent's first name and the enquiry, exactly as the spec's first sentence reads.
3. **`openTask` carries `title` as well as `id`, `dueAt` and `status`.** The follow-up strip is specified to show the title; taking it from the same include costs nothing and avoids a second read.

## File structure

| Path | Responsibility |
| --- | --- |
| `Backend/prisma/schema.prisma` | Two enums, `FollowUpTask`, `CrmSettings`, new columns on `WorkspaceMember` and `Conversation`, back-relations |
| `Backend/prisma/migrations/0027_crm_lead_routing/migration.sql` | The same change as hand-written SQL, plus the partial unique index |
| `Backend/src/crm/interest.rules.ts` | `classify()` — pure, deterministic, no I/O |
| `Backend/src/crm/interest.rules.test.ts` | One fixture per profile, thresholds, borrow, stickiness |
| `Backend/src/crm/round.robin.ts` | `orderFor()` (pure, testable) and `RoundRobin.pick()` (one raw statement) |
| `Backend/src/crm/round.robin.test.ts` | Rotation order over in-memory rows |
| `Backend/src/crm/crm.settings.ts` | `CrmSettingsService`: read, save, resolve the designation |
| `Backend/src/crm/tasks.service.ts` | `createTask()` (the only dedupe point), `list`, `update`, `waLink` |
| `Backend/src/crm/lead.intake.ts` | `consider()` — the seven steps of the spec's intake |
| `Backend/src/crm/lead.intake.test.ts` | Stubbed Prisma: writes, no-ops, dedupe, swallowed failures |
| `Backend/src/crm/crm.pipeline.ts` | `columnOf()` — stored state to board column, pure |
| `Backend/src/crm/crm.pipeline.test.ts` | The four columns and the overdue case |
| `Backend/src/crm/crm.service.ts` | `pipeline()` and `setInterest()` |
| `Backend/src/crm/crm.dto.ts` | `SetInterestDto`, `UpdateTaskDto`, `CrmSettingsDto`, `ListTasksDto` |
| `Backend/src/crm/crm.controller.ts` | The seven routes and their guards |
| `Backend/src/crm/crm.module.ts` | Wiring; exports `LeadIntake` for the webhook |
| `Backend/src/workspaces/dto/team.dto.ts` | `UpdateMemberProfileDto` + phone normalisation |
| `Backend/src/workspaces/workspaces.service.ts` | `memberView()` helper, `updateProfile()`, profile fields on the member select |
| `Backend/src/workspaces/workspaces.controller.ts` | `PATCH members/:userId/profile` |
| `Backend/src/workspaces/modules.ts` | `crm` key, label, ADMIN + MANAGER defaults |
| `Backend/src/inbox/dto/list-conversations.dto.ts` | `interest` filter |
| `Backend/src/inbox/inbox.view.ts` | Stage fields and `openTask` on the conversation selection and view |
| `Backend/src/inbox/inbox.service.ts` | `where.interest` |
| `Backend/src/whatsapp/whatsapp-webhook.service.ts` | `LeadIntake.consider()` (injected as `leads`) beside `ReplyIntake.enqueue()` |
| `Backend/src/whatsapp/whatsapp.module.ts`, `Backend/src/app.module.ts` | Import `CrmModule` |
| `frontend/src/config/modules.ts` | Mirror of the `crm` key, label and hint |
| `frontend/src/config/workspace-nav.ts` | `/workspace/crm` under Operations |
| `frontend/src/features/crm/api.ts` | The CRM contract |
| `frontend/src/features/crm/components/crm-view.tsx` | Tabs: Pipeline, My follow-ups, Routing |
| `frontend/src/features/crm/components/pipeline-board.tsx` | Four columns of conversation cards |
| `frontend/src/features/crm/components/task-list.tsx` | The follow-up list on the Leads screen |
| `frontend/src/features/crm/components/routing-settings.tsx` | The owner's routing form |
| `frontend/src/features/crm/components/interest-chip.tsx` | The stage strip in the thread, with a manager's override |
| `frontend/src/features/crm/components/follow-up-strip.tsx` | The task strip under the thread header |
| `frontend/src/features/crm/components/follow-ups-card.tsx` | "Your follow-ups" on the overview |
| `frontend/src/app/(app)/workspace/crm/page.tsx` | The route shell |
| `frontend/src/features/team/api.ts` | Member profile fields + `updateMemberProfile()` |
| `frontend/src/features/team/components/member-profile-sheet.tsx` | Name, designation and personal number |
| `frontend/src/features/team/components/team-view.tsx` | Designation column + row action |
| `frontend/src/features/inbox/api.ts` | Stage fields, `openTask`, `interest` filter |
| `frontend/src/features/inbox/components/conversation-list.tsx` | Interest filter section + row chip |
| `frontend/src/features/inbox/components/message-thread.tsx` | Renders both new components |
| `frontend/src/app/(app)/workspace/page.tsx` | Mounts `FollowUpsCard` |

---

### Task 1: Schema and the hand-written migration

**Files:**
- Modify: `Backend/prisma/schema.prisma` (enums section, `User`, `Workspace`, `WorkspaceMember`, `Conversation`, plus a new CRM section at the end)
- Create: `Backend/prisma/migrations/0027_crm_lead_routing/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma types `LeadInterest`, `FollowUpStatus`, `FollowUpTask`, `CrmSettings`; `WorkspaceMember.designation`, `.personalWhatsApp`, `.lastAssignedAt`; `Conversation.interest`, `.interestScore`, `.interestReason`, `.interestAt`, `.followUpTasks`.

- [ ] **Step 1: Add the two enums and the four fields to `WorkspaceMember`**

In `model WorkspaceMember`, after `role`:

```prisma
  /// Free text: "Sales Executive", "Support Agent". Round-robin filters on it.
  designation      String?   @map("designation")
  /// Digits only, country code first, no "+" — the same shape as Contact.waId.
  personalWhatsApp String?   @map("personal_whatsapp")
  /// Round-robin cursor. Written only by the lead router, never by a manual
  /// reassignment in the inbox: handing a thread over must not skew rotation.
  lastAssignedAt   DateTime? @map("last_assigned_at")
```

and add the index beside the existing `@@index([userId])`:

```prisma
  @@index([workspaceId, designation])
```

- [ ] **Step 2: Add the four stage fields and the back-relation to `Conversation`**

After `aiPauseReason`:

```prisma
  /// What the customer's words said about buying, decided by
  /// `Backend/src/crm/interest.rules.ts`. UNKNOWN is "nothing said yet".
  interest       LeadInterest @default(UNKNOWN)
  /// The evidence of the message that decided the stage, clamped ±100.
  interestScore  Int?         @map("interest_score")
  /// The phrase that decided it (`matched "how much" (BUYING)`), `no buying or
  /// refusal signal`, or `manual` after an override.
  interestReason String?      @map("interest_reason")
  interestAt     DateTime?    @map("interest_at")
```

Add beside `notes InternalNote[]`:

```prisma
  followUpTasks FollowUpTask[]
```

and add the index beside `@@index([workspaceId, status, lastMessageAt])`:

```prisma
  @@index([workspaceId, interest, lastMessageAt])
```

- [ ] **Step 3: Add the two back-relations**

In `model User`, beside `notes`:

```prisma
  /// Follow-up tasks this user owns.
  tasks                 FollowUpTask[] @relation("TaskAssignee")
```

In `model Workspace`, beside `botFlows`:

```prisma
  followUpTasks FollowUpTask[]
  crmSettings   CrmSettings?
```

- [ ] **Step 4: Add the CRM section at the end of `schema.prisma`**

```prisma
// ---------------------------------------------------------------------------
// CRM: lead stage, follow-up tasks and lead-routing settings.
//
// A lead is a conversation plus a stage, never a second copy of the message
// store. One open task per thread is enforced by a partial unique index that
// the migration writes by hand, because Prisma cannot express one.
// ---------------------------------------------------------------------------

/// What a customer's words said about buying. UNKNOWN is "nothing said yet".
enum LeadInterest {
  UNKNOWN
  INTERESTED
  NOT_INTERESTED
}

enum FollowUpStatus {
  OPEN
  DONE
  CANCELLED
}

model FollowUpTask {
  id               String         @id @default(uuid()) @db.Uuid
  workspaceId      String         @map("workspace_id") @db.Uuid
  conversationId   String         @map("conversation_id") @db.Uuid
  assignedToUserId String?        @map("assigned_to_user_id") @db.Uuid
  title            String
  note             String?
  dueAt            DateTime?      @map("due_at")
  status           FollowUpStatus @default(OPEN)
  completedAt      DateTime?      @map("completed_at")
  createdAt        DateTime       @default(now()) @map("created_at")
  updatedAt        DateTime       @updatedAt @map("updated_at")

  workspace    Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  assignedTo   User?        @relation("TaskAssignee", fields: [assignedToUserId], references: [id], onDelete: SetNull)

  @@index([workspaceId, status, dueAt])
  @@index([assignedToUserId, status])
  @@map("follow_up_tasks")
}

/// Same shape as BusinessProfile: the workspace id is the key. A workspace
/// with no row reads the defaults in this file's plan, not a seeded row.
model CrmSettings {
  workspaceId     String   @id @map("workspace_id") @db.Uuid
  leadDesignation String?  @map("lead_designation")
  autoAssign      Boolean  @default(true) @map("auto_assign")
  autoTask        Boolean  @default(true) @map("auto_task")
  taskDueHours    Int      @default(24) @map("task_due_hours")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@map("crm_settings")
}
```

- [ ] **Step 5: Write the migration SQL**

Create `Backend/prisma/migrations/0027_crm_lead_routing/migration.sql`:

```sql
-- CRM lead routing: a stage on every conversation, one open follow-up task per
-- thread, and the owner's routing settings.
--
-- Hand-written because Prisma DDL cannot express a partial unique index, and
-- because this repository authors migrations as SQL and applies them with
-- `prisma migrate deploy` (never `migrate dev` or `db push`).

CREATE TYPE "LeadInterest" AS ENUM ('UNKNOWN', 'INTERESTED', 'NOT_INTERESTED');
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- Who a lead of this designation goes to, and where the rotation left off.
ALTER TABLE "workspace_members"
    ADD COLUMN "designation" TEXT,
    ADD COLUMN "personal_whatsapp" TEXT,
    ADD COLUMN "last_assigned_at" TIMESTAMP(3);

CREATE INDEX "workspace_members_workspace_id_designation_idx"
    ON "workspace_members" ("workspace_id", "designation");

-- Existing conversations start UNKNOWN with no timestamp: the column default
-- covers them, and no backfill is written into a migration.
ALTER TABLE "conversations"
    ADD COLUMN "interest" "LeadInterest" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN "interest_score" INTEGER,
    ADD COLUMN "interest_reason" TEXT,
    ADD COLUMN "interest_at" TIMESTAMP(3);

CREATE INDEX "conversations_workspace_id_interest_last_message_at_idx"
    ON "conversations" ("workspace_id", "interest", "last_message_at");

CREATE TABLE "follow_up_tasks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "assigned_to_user_id" UUID,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "due_at" TIMESTAMP(3),
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "follow_up_tasks_workspace_id_status_due_at_idx"
    ON "follow_up_tasks" ("workspace_id", "status", "due_at");
CREATE INDEX "follow_up_tasks_assigned_to_user_id_status_idx"
    ON "follow_up_tasks" ("assigned_to_user_id", "status");

-- One open task per thread: a retried delivery or a second "price?" message
-- must find the existing task, never stack a second one.
CREATE UNIQUE INDEX "follow_up_tasks_one_open_per_conversation"
    ON "follow_up_tasks" ("conversation_id")
    WHERE "status" = 'OPEN';

-- Deleting a workspace or a thread takes its tasks with it, like every other
-- tenant row; an assignee leaving keeps the task and frees it.
ALTER TABLE "follow_up_tasks"
    ADD CONSTRAINT "follow_up_tasks_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_up_tasks"
    ADD CONSTRAINT "follow_up_tasks_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_up_tasks"
    ADD CONSTRAINT "follow_up_tasks_assigned_to_user_id_fkey"
    FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "crm_settings" (
    "workspace_id" UUID NOT NULL,
    "lead_designation" TEXT,
    "auto_assign" BOOLEAN NOT NULL DEFAULT true,
    "auto_task" BOOLEAN NOT NULL DEFAULT true,
    "task_due_hours" INTEGER NOT NULL DEFAULT 24,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_settings_pkey" PRIMARY KEY ("workspace_id")
);

ALTER TABLE "crm_settings"
    ADD CONSTRAINT "crm_settings_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 6: Validate the schema and regenerate the client**

Run: `cd Backend; npx prisma validate; npx prisma generate`
Expected: `The schema at prisma\schema.prisma is valid`, then `Generated Prisma Client`. Neither command touches the database.

- [ ] **Step 7: Checkpoint**

Run: `cd Backend; npx tsc -p tsconfig.json --noEmit; git status --short`
Expected: no type errors; `git status` lists only `prisma/schema.prisma` and the new migration directory. Do not commit.

---

### Task 2: The interest classifier

**Files:**
- Create: `Backend/src/crm/interest.rules.ts`
- Test: `Backend/src/crm/interest.rules.test.ts`

**Interfaces:**
- Consumes: `wordsOf()` from `../bots/bot.rules` (NFKC, lowercase, punctuation to spaces).
- Produces:
  ```ts
  export interface InterestState {
    stage: LeadInterest;
    score: number | null;
    body: string | null;
    /** `Conversation.interestReason`; the sticky origin survives through it. */
    reason?: string | null;
  }
  export interface InterestVerdict {
    interest: LeadInterest;
    score: number;
    reason: string;
  }
  export function classify(body: string, previous: InterestState): InterestVerdict;
  export const NO_SIGNAL = "no buying or refusal signal";
  export const MANUAL_REASON = "manual";
  export const THRESHOLD = 3;
  ```

- [ ] **Step 1: Write the failing tests**

Create `Backend/src/crm/interest.rules.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { classify, MANUAL_REASON, NO_SIGNAL, type InterestState } from "./interest.rules";

const fresh: InterestState = { stage: "UNKNOWN", score: null, body: null };

function after(body: string, stage: InterestState["stage"], score: number): InterestState {
  return { stage, score, body };
}

test("a buying question is INTERESTED and names the phrase", () => {
  const verdict = classify("How much is the rate for 10 boxes?", fresh);

  assert.equal(verdict.interest, "INTERESTED");
  assert.equal(verdict.score >= 3, true);
  assert.match(verdict.reason, /^matched ".+" \(BUYING\)$/);
});

test("a bare price question is INTERESTED without the structural bonus", () => {
  const verdict = classify("price", fresh);

  assert.equal(verdict.interest, "INTERESTED");
  assert.equal(verdict.score, 3);
  assert.equal(verdict.reason, 'matched "price" (BUYING)');
});

test("an opt-out is NOT_INTERESTED and does not auto-clear", () => {
  const stop = classify("stop messaging me", fresh);
  assert.equal(stop.interest, "NOT_INTERESTED");
  assert.equal(stop.reason, 'matched "stop messaging" (STOP)');

  const later = classify("ok fine", after("stop messaging me", "NOT_INTERESTED", stop.score));
  assert.equal(later.interest, "NOT_INTERESTED");
});

test("an opt-out clears on a buying phrase", () => {
  const verdict = classify("ok what is the price", after("stop messaging me", "NOT_INTERESTED", -4));

  assert.equal(verdict.interest, "INTERESTED");
});

test("an opt-out does not clear on contact details alone", () => {
  const verdict = classify("call me", after("stop messaging me", "NOT_INTERESTED", -4));

  assert.equal(verdict.interest, "NOT_INTERESTED");
});

test("a refusal clears on contact details and lands at UNKNOWN", () => {
  const verdict = classify("call me", after("not interested", "NOT_INTERESTED", -3));

  assert.equal(verdict.interest, "UNKNOWN");
  assert.equal(verdict.score, 2);
  assert.equal(verdict.reason, 'matched "call me" (CONTACT)');
});

test("a refusal outranks a price in the same sentence", () => {
  const verdict = classify("not interested in the price", fresh);

  assert.equal(verdict.interest, "NOT_INTERESTED");
  assert.equal(verdict.reason, 'matched "not interested" (REFUSAL)');
});

test("hesitation alone is not a no", () => {
  const verdict = classify("not now maybe later", fresh);

  assert.equal(verdict.interest, "UNKNOWN");
  assert.equal(verdict.score, -1);
});

test("a reply too short to carry a signal borrows the stored score", () => {
  const verdict = classify("ok", after("how much is the price", "INTERESTED", 4));

  assert.equal(verdict.interest, "INTERESTED");
  assert.equal(verdict.score, 4);
  assert.equal(verdict.reason, NO_SIGNAL);
});

test("a long message with no signal never moves a stage backwards", () => {
  const verdict = classify("hello there my friend how are you doing", after("price?", "INTERESTED", 4));

  assert.equal(verdict.interest, "INTERESTED");
  assert.equal(verdict.score, 4);
  assert.equal(verdict.reason, NO_SIGNAL);
});

test("structural signals decide a message that carries no phrase of its own", () => {
  const verdict = classify("do you sell 300 boxes at rs 200?", fresh);

  assert.equal(verdict.interest, "INTERESTED");
  assert.equal(verdict.score, 3);
});

test("a short message with only a number borrows the stored score", () => {
  const verdict = classify("5000 boxes", after("how much is the price", "INTERESTED", 3));

  assert.equal(verdict.interest, "INTERESTED");
  assert.equal(verdict.score, 3);
  assert.equal(verdict.reason, NO_SIGNAL);
});

test("the manual reason is a distinct stored string", () => {
  assert.equal(MANUAL_REASON, "manual");
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `cd Backend; npm test`
Expected: FAIL — `Cannot find module './interest.rules'`.

- [ ] **Step 3: Write the classifier**

Create `Backend/src/crm/interest.rules.ts`:

```ts
import type { LeadInterest } from "@prisma/client";

import { wordsOf } from "../bots/bot.rules";

/**
 * The stage a conversation carries before and after a message, plus the
 * evidence for the last verdict: the previous inbound body is what makes the
 * sticky rules below possible without a second column.
 */
export interface InterestState {
  stage: LeadInterest;
  score: number | null;
  body: string | null;
}

export interface InterestVerdict {
  interest: LeadInterest;
  score: number;
  /** Names the deciding phrase, the absence of one, or a carried-over score. */
  reason: string;
}

export type ProfileKey =
  | "STOP"
  | "REFUSAL"
  | "SOFT_NO"
  | "BUYING"
  | "CONTACT"
  | "URGENCY";

interface Profile {
  readonly key: ProfileKey;
  readonly weight: number;
  readonly phrases: readonly string[];
}

/**
 * Ordered strongest-refusal first: a message that both refuses and asks a price
 * ("not interested in the price") is a refusal, not a sale.
 *
 * English plus the transliterated Hinglish the same conversations carry. The
 * list is the tuning surface: a wrong guess is fixed here, not in the intake.
 */
const PROFILES: readonly Profile[] = [
  {
    key: "STOP",
    weight: -4,
    phrases: [
      "stop messaging",
      "stop sending",
      "do not message",
      "don't message",
      "remove my number",
      "remove me",
      "unsubscribe",
      "stop",
    ],
  },
  {
    key: "REFUSAL",
    weight: -3,
    phrases: [
      "not interested",
      "no interest",
      "already bought",
      "already have",
      "no need",
      "not required",
      "wrong number",
      "nahi chahiye",
    ],
  },
  {
    key: "SOFT_NO",
    weight: -1,
    phrases: [
      "not now",
      "maybe later",
      "later",
      "busy",
      "will think",
      "think about it",
      "sochna",
    ],
  },
  {
    key: "BUYING",
    weight: 3,
    phrases: [
      "how much",
      "rate kya",
      "kitna",
      "price",
      "cost",
      "rate",
      "quote",
      "quotation",
      "available",
      "stock",
      "demo",
      "sample",
      "catalogue",
      "brochure",
      "order",
      "subscribe",
      "details",
      "chahiye",
    ],
  },
  {
    key: "CONTACT",
    weight: 2,
    phrases: ["call me", "send me", "my number", "email me", "contact me"],
  },
  {
    key: "URGENCY",
    weight: 1,
    phrases: ["today", "now", "urgent", "asap"],
  },
];

const NEGATIVE: ReadonlySet<ProfileKey> = new Set(["STOP", "REFUSAL", "SOFT_NO"]);

/** Score at or above this is a lead; at or below its negation, a no. */
export const THRESHOLD = 3;

export const NO_SIGNAL = "no buying or refusal signal";
export const MANUAL_REASON = "manual";

const CURRENCY = /[₹$]|\b(?:rs|inr|aed)\b/iu;
const QUANTITY = /\d+\s*(?:pcs?|pieces?|boxes?|box|kg|units?|nos)\b/iu;

interface Hit {
  profile: Profile;
  phrase: string;
}

function hitsOf(body: string): Hit[] {
  const words = wordsOf(body);
  if (!words) return [];

  const padded = ` ${words} `;
  const hits: Hit[] = [];

  for (const profile of PROFILES) {
    let best: string | null = null;

    for (const phrase of profile.phrases) {
      const needle = wordsOf(phrase);
      if (!needle || !padded.includes(` ${needle} `)) continue;
      if (best === null || needle.length > best.length) best = needle;
    }

    if (best !== null) hits.push({ profile, phrase: best });
  }

  return hits;
}

/** The group that decides the message: any refusal outranks every positive. */
function decidingOf(hits: readonly Hit[]): Hit[] {
  const negatives = hits.filter((hit) => NEGATIVE.has(hit.profile.key));
  return negatives.length > 0 ? negatives : [...hits];
}

function strongest(hits: readonly Hit[]): Hit {
  return hits.reduce((best, hit) =>
    Math.abs(hit.profile.weight) > Math.abs(best.profile.weight) ? hit : best,
  );
}

/** Structural evidence, capped at +3: a question, a currency, a quantity. */
function structuralOf(body: string): number {
  return (body.includes("?") ? 1 : 0) + (CURRENCY.test(body) ? 1 : 0) + (QUANTITY.test(body) ? 1 : 0);
}

function clamp(score: number): number {
  return Math.max(-100, Math.min(100, score));
}

function stageOf(score: number): LeadInterest {
  if (score >= THRESHOLD) return "INTERESTED";
  if (score <= -THRESHOLD) return "NOT_INTERESTED";
  return "UNKNOWN";
}

/** The profile the last deciding message belonged to, re-read from its body. */
function profileOf(body: string | null): ProfileKey | null {
  if (!body) return null;

  const hits = hitsOf(body);
  return hits.length > 0 ? strongest(decidingOf(hits)).profile.key : null;
}

/**
 * Reads one inbound message against the thread's stored stage.
 *
 * The score is this message's evidence, not a running total: a running total
 * would need a second threshold to undo a refusal that arrived after three
 * buying questions, and the spec's stickiness rules assume per-message
 * evidence. The stored score is what the last deciding message found.
 */
export function classify(body: string, previous: InterestState): InterestVerdict {
  const hits = hitsOf(body);
  const words = wordsOf(body).split(" ").filter(Boolean);
  const carried = clamp(previous.score ?? 0);

  // No phrase at all: the message can only keep what the thread had. A short
  // reply is the reason this rule exists — "how much?" → "₹200" → "ok" must
  // stay a lead — and a long message without a signal must never move a stage
  // backwards. The one exception is a long message whose shape alone is a
  // signal (a question, a currency, a quantity).
  if (hits.length === 0) {
    const structural = words.length < 4 ? 0 : structuralOf(body);

    if (structural === 0) {
      return { interest: previous.stage, score: carried, reason: NO_SIGNAL };
    }

    return {
      interest: stageOf(structural),
      score: clamp(structural),
      reason: `structural signals (${structural})`,
    };
  }

  const deciding = decidingOf(hits);
  const negative = NEGATIVE.has(deciding[0].profile.key);
  const delta = negative
    ? deciding.reduce((sum, hit) => sum + hit.profile.weight, 0)
    : deciding.reduce((sum, hit) => sum + hit.profile.weight, 0) + structuralOf(body);

  const score = clamp(delta);
  const best = strongest(deciding);
  const reason = `matched "${best.phrase}" (${best.profile.key})`;

  // A refusal sticks until the customer asks to buy: one "ok" must not
  // resurrect somebody who asked to be left alone.
  if (previous.stage === "NOT_INTERESTED") {
    const cleared = profileOf(previous.body);

    if (cleared === "STOP" && !hits.some((hit) => hit.profile.key === "BUYING")) {
      return { interest: "NOT_INTERESTED", score: carried, reason: `carried over: ${NO_SIGNAL}` };
    }

    if (
      cleared === "REFUSAL" &&
      !hits.some((hit) => hit.profile.key === "BUYING" || hit.profile.key === "CONTACT")
    ) {
      return { interest: "NOT_INTERESTED", score: carried, reason: `carried over: ${NO_SIGNAL}` };
    }
  }

  return { interest: stageOf(score), score, reason };
}
```

- [ ] **Step 4: Run the tests until they pass**

Run: `cd Backend; npm test`
Expected: every `interest.rules` test passes. If a fixture disagrees, the profile table or the `wordsOf` normalisation is wrong — fix the source, not the assertion.

- [ ] **Step 5: Checkpoint**

Run: `cd Backend; npm run typecheck; git status --short`
Expected: no type errors; two new files listed. Do not commit.

---

### Task 3: Round-robin picker

**Files:**
- Create: `Backend/src/crm/round.robin.ts`
- Test: `Backend/src/crm/round.robin.test.ts`

**Interfaces:**
- Consumes: `PrismaService`.
- Produces:
  ```ts
  export interface RosterRow {
    userId: string;
    role: string;
    designation: string | null;
    lastAssignedAt: Date | null;
  }
  export function orderFor(rows: readonly RosterRow[], designation: string): RosterRow[];
  export class RoundRobin {
    pick(workspaceId: string, designation: string): Promise<string | null>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `Backend/src/crm/round.robin.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { orderFor, type RosterRow } from "./round.robin";

const rows: RosterRow[] = [
  { userId: "b", role: "AGENT", designation: "Sales", lastAssignedAt: new Date("2026-11-27T10:00:00Z") },
  { userId: "a", role: "AGENT", designation: "Sales", lastAssignedAt: null },
  { userId: "c", role: "AGENT", designation: "Sales", lastAssignedAt: new Date("2026-11-26T10:00:00Z") },
  { userId: "owner", role: "OWNER", designation: "Sales", lastAssignedAt: null },
  { userId: "d", role: "AGENT", designation: "Support", lastAssignedAt: null },
];

test("never picked before wins, then the oldest pick, then the id", () => {
  assert.deepEqual(
    orderFor(rows, "Sales").map((row) => row.userId),
    ["a", "c", "b"],
  );
});

test("the owner is never in the rotation", () => {
  assert.equal(
    orderFor(rows, "Sales").some((row) => row.userId === "owner"),
    false,
  );
});

test("another designation is not in this rotation", () => {
  assert.deepEqual(orderFor(rows, "Support").map((row) => row.userId), ["d"]);
});

test("a designation nobody carries picks nobody", () => {
  assert.deepEqual(orderFor(rows, "Finance"), []);
});
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd Backend; npm test`
Expected: FAIL — `Cannot find module './round.robin'`.

- [ ] **Step 3: Write the picker**

Create `Backend/src/crm/round.robin.ts`:

```ts
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

export interface RosterRow {
  userId: string;
  role: string;
  designation: string | null;
  lastAssignedAt: Date | null;
}

/**
 * The rotation order, as a pure function so the statement's ORDER BY is
 * testable without a database: never picked first, then the oldest pick, then
 * the id so two members picked in the same instant still take turns.
 */
export function orderFor(rows: readonly RosterRow[], designation: string): RosterRow[] {
  return rows
    .filter((row) => row.role !== "OWNER" && row.designation === designation)
    .sort((left, right) => {
      const a = left.lastAssignedAt?.getTime() ?? -Infinity;
      const b = right.lastAssignedAt?.getTime() ?? -Infinity;

      if (a !== b) return a < b ? -1 : 1;
      return left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0;
    });
}

/**
 * Hands one lead to the next member with the designation.
 *
 * One statement: the subquery locks the row it picks, so two deliveries at the
 * same instant get two different members instead of the same one twice. This
 * is why it is not an interactive transaction — the Supabase pooler cannot
 * carry one.
 */
@Injectable()
export class RoundRobin {
  constructor(private readonly prisma: PrismaService) {}

  async pick(workspaceId: string, designation: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ user_id: string }[]>`
      UPDATE workspace_members
         SET last_assigned_at = now()
       WHERE (workspace_id, user_id) = (
         SELECT workspace_id, user_id
           FROM workspace_members
          WHERE workspace_id = ${workspaceId}::uuid
            AND role <> 'OWNER'::"WorkspaceRole"
            AND designation = ${designation}
          ORDER BY last_assigned_at ASC NULLS FIRST, user_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
      RETURNING user_id;
    `;

    return rows[0]?.user_id ?? null;
  }
}
```

- [ ] **Step 4: Run the tests until they pass**

Run: `cd Backend; npm test`
Expected: the four rotation tests pass, and the classifier tests from Task 2 still pass.

- [ ] **Step 5: Checkpoint**

Run: `cd Backend; npm run typecheck; git status --short`
Expected: no type errors. Do not commit.

---

### Task 4: Member profile fields

**Files:**
- Modify: `Backend/src/workspaces/dto/team.dto.ts`
- Modify: `Backend/src/workspaces/workspaces.service.ts` (`MemberView`, `memberView()`, `view()`, `changeRole()`, `updateProfile()`)
- Modify: `Backend/src/workspaces/workspaces.controller.ts`
- Test: `Backend/src/workspaces/team.dto.test.ts`

**Interfaces:**
- Consumes: `Roles`, `primaryFor`, `MemberView`.
- Produces:
  ```ts
  export function phoneDigits(value: unknown): unknown;
  export class UpdateMemberProfileDto {
    fullName?: string | null;
    designation?: string | null;
    personalWhatsApp?: string | null;
  }
  // WorkspacesService
  updateProfile(claims: AuthClaims, userId: string, dto: UpdateMemberProfileDto): Promise<{ member: MemberView }>;
  // MemberView gains
  designation: string | null;
  personalWhatsApp: string | null;
  ```

- [ ] **Step 1: Write the failing test**

Create `Backend/src/workspaces/team.dto.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { phoneDigits, UpdateMemberProfileDto } from "./dto/team.dto";

async function errorsFor(input: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpdateMemberProfileDto, input);
  return (await validate(dto)).flatMap((error) => Object.keys(error.constraints ?? {}));
}

test("a local number loses its punctuation", () => {
  assert.equal(phoneDigits("+91 98765-43210"), "919876543210");
});

test("an empty field clears the number", () => {
  assert.equal(phoneDigits("  "), null);
});

test("a valid number passes validation", async () => {
  const dto = plainToInstance(UpdateMemberProfileDto, { personalWhatsApp: "+91 98765 43210" });

  assert.deepEqual(await validate(dto), []);
  assert.equal(dto.personalWhatsApp, "919876543210");
});

test("seven digits and letters are refused", async () => {
  assert.equal((await errorsFor({ personalWhatsApp: "1234567" })).length, 1);
  assert.equal((await errorsFor({ personalWhatsApp: "call me" })).length, 1);
});

test("a designation longer than 40 characters is refused", async () => {
  assert.equal((await errorsFor({ designation: "x".repeat(41) })).length, 1);
});

test("an empty body clears nothing but is valid", async () => {
  assert.deepEqual(await errorsFor({}), []);
});
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd Backend; npm test`
Expected: FAIL — `UpdateMemberProfileDto` and `phoneDigits` are not exported.

- [ ] **Step 3: Add the DTO and the phone helper**

In `Backend/src/workspaces/dto/team.dto.ts`, extend the import from `class-validator` with `IsOptional`, `Matches`, and add at the end:

```ts
/**
 * A personal number in the shape the `wa.me` link needs: digits only, country
 * code first, no `+`. An empty field means "clear it", which is how the owner
 * undoes a typo without another route.
 */
export function phoneDigits(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const digits = value.replace(/[\s+()-]/g, "");
  return digits.length === 0 ? null : digits;
}

/**
 * What the owner may change on a member. Email is deliberately absent: it is
 * the Supabase auth identity, and changing it here would lock the member out
 * until they verified the new address.
 */
export class UpdateMemberProfileDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  fullName?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(40)
  designation?: string | null;

  @IsOptional()
  @Transform(({ value }) => phoneDigits(value))
  @Matches(/^\d{8,15}$/, {
    message: "Enter the number with its country code, digits only.",
  })
  personalWhatsApp?: string | null;
}
```

- [ ] **Step 4: Extract one `memberView()` and add the new fields**

In `Backend/src/workspaces/workspaces.service.ts`, add the two fields to `MemberView`:

```ts
  /** Free text: who this person is on the team. Null until the owner sets it. */
  designation: string | null;
  /** Digits only, country code first. Null until the owner sets it. */
  personalWhatsApp: string | null;
```

Add this function near `invitationView`:

```ts
type MemberRow = {
  userId: string;
  role: WorkspaceRole;
  designation: string | null;
  personalWhatsApp: string | null;
  user: { fullName: string | null; email: string; avatarUrl: string | null };
};

/** One shape for the team screen, the role change and a profile edit. */
function memberView(row: MemberRow, ownerId: string): MemberView {
  return {
    userId: row.userId,
    role: row.role,
    name: row.user.fullName,
    email: row.user.email,
    avatarUrl: row.user.avatarUrl,
    owner: row.userId === ownerId,
    designation: row.designation,
    personalWhatsApp: row.personalWhatsApp,
  };
}
```

In `view()`, add `designation: true, personalWhatsApp: true` to the member select and replace the inline map with:

```ts
      members: members.map((row) => memberView(row, workspace.ownerId)),
```

In `changeRole()`, add the same two fields to its `select` and replace the returned object with:

```ts
    return { member: memberView(row, workspace.ownerId) };
```

(`changeRole` already loads `workspace.ownerId` for the immutability check —
reuse that value; do not read the workspace a second time.)

- [ ] **Step 5: Add the service method**

After `changeRole()` in `Backend/src/workspaces/workspaces.service.ts`:

```ts
  /**
   * The owner edits a member's profile: the name customers never see, the
   * designation the lead router filters on, and the personal number a
   * follow-up is sent from. Every field is optional; `null` clears it.
   */
  async updateProfile(
    claims: AuthClaims,
    userId: string,
    dto: UpdateMemberProfileDto,
  ): Promise<{ member: MemberView }> {
    const { workspaceId } = await this.primaryFor(claims);
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { ownerId: true },
    });

    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { userId: true },
    });

    if (!member) {
      throw new NotFoundException({
        code: "MEMBER_MISSING",
        message: "That person is not on this team.",
      });
    }

    if (dto.fullName !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { fullName: dto.fullName?.trim() ? dto.fullName.trim() : null },
      });
    }

    const data: { designation?: string | null; personalWhatsApp?: string | null } = {};

    if (dto.designation !== undefined) {
      data.designation = dto.designation?.trim() ? dto.designation.trim() : null;
    }

    if (dto.personalWhatsApp !== undefined) {
      data.personalWhatsApp = dto.personalWhatsApp ?? null;
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId } },
        data,
      });
    }

    const row = await this.prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: {
        userId: true,
        role: true,
        designation: true,
        personalWhatsApp: true,
        user: { select: { fullName: true, email: true, avatarUrl: true } },
      },
    });

    return { member: memberView(row, workspace.ownerId) };
  }
```

- [ ] **Step 6: Add the route**

In `Backend/src/workspaces/workspaces.controller.ts`, import `UpdateMemberProfileDto` and add below `changeRole`:

```ts
  /**
   * PATCH /api/v1/workspaces/members/:userId/profile — the owner edits a
   * member's name, designation and personal WhatsApp number.
   *
   * Email is not in the body: it is the auth identity, and changing it from a
   * workspace screen would lock the member out until they verified it.
   */
  @Patch("members/:userId/profile")
  @Roles("OWNER")
  updateProfile(
    @CurrentUser() claims: AuthClaims,
    @Param("userId") userId: string,
    @Body() dto: UpdateMemberProfileDto,
  ) {
    return this.workspaces.updateProfile(claims, userId, dto);
  }
```

- [ ] **Step 7: Run the tests and both gates**

Run: `cd Backend; npm test; npm run typecheck; npx nest build`
Expected: the DTO tests pass, `npm test` stays green, no type errors, the build completes.

- [ ] **Step 8: Checkpoint**

Run: `cd Backend; git status --short`
Expected: five modified files plus the new test. Do not commit.

---

### Task 5: The `crm` module key

**Files:**
- Modify: `Backend/src/workspaces/modules.ts`
- Modify: `Backend/src/workspaces/modules.test.ts`
- Modify: `frontend/src/config/modules.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ModuleKey` includes `"crm"`; `MODULE_DEFAULTS.ADMIN` and `.MANAGER` include it, `.AGENT` does not.

- [ ] **Step 1: Extend the failing expectation first**

In `Backend/src/workspaces/modules.test.ts`, add `"crm"` to the ADMIN list after `"analytics"`, and to the MANAGER list after `"analytics"`, in *both* assertions (`MODULE_DEFAULTS` at the top and `effectiveModules("MANAGER", [])` further down), and in the "a stored row removes a module" expectation:

```ts
  assert.deepEqual(effectiveModules("MANAGER", [
    { module: "campaigns", enabled: false },
  ]), ["inbox", "contacts", "analytics", "crm"]);
```

Add one new test at the end:

```ts
test("the pipeline is a manager's and an admin's, not an agent's", () => {
  assert.equal(MODULE_DEFAULTS.ADMIN.includes("crm"), true);
  assert.equal(MODULE_DEFAULTS.MANAGER.includes("crm"), true);
  assert.equal(MODULE_DEFAULTS.AGENT.includes("crm"), false);
});
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd Backend; npm test`
Expected: FAIL — `crm` is not a `ModuleKey`, so the arrays differ.

- [ ] **Step 3: Add the key in registry order**

In `Backend/src/workspaces/modules.ts`:

```ts
export const MODULE_KEYS = [
  "inbox",
  "contacts",
  "qr-codes",
  "campaigns",
  "templates",
  "chatbot",
  "automations",
  "ai",
  "analytics",
  "crm",
  "team",
  "whatsapp",
  "billing",
  "profile",
] as const;
```

In `MODULE_DEFAULTS.ADMIN`, insert `"crm",` after `"analytics",`. In `MODULE_DEFAULTS.MANAGER`:

```ts
  MANAGER: ["inbox", "contacts", "campaigns", "analytics", "crm"],
```

In `MODULE_LABELS`:

```ts
  crm: "Leads (CRM)",
```

- [ ] **Step 4: Mirror it on the frontend**

In `frontend/src/config/modules.ts`, add `"crm"` to `MODULE_KEYS` in the same position, then:

```ts
  crm: "Leads (CRM)",
```

inside `MODULE_LABELS`, and inside `MODULE_HINTS`:

```ts
  crm: "The pipeline, follow-up tasks and who receives new leads",
```

- [ ] **Step 5: Run the tests and the gates**

Run: `cd Backend; npm test; npm run typecheck`
Run: `cd frontend; npx tsc --noEmit`
Expected: all green. A missing entry in `MODULE_LABELS` or `MODULE_HINTS` is a type error, which is the point of the `Record<ModuleKey, string>` shape.

- [ ] **Step 6: Checkpoint**

Run: `git status --short`
Expected: three modified files. Do not commit.

---

### Task 6: CRM module — settings, tasks and their routes

**Files:**
- Create: `Backend/src/crm/crm.dto.ts`
- Create: `Backend/src/crm/crm.settings.ts`
- Create: `Backend/src/crm/tasks.service.ts`
- Create: `Backend/src/crm/crm.controller.ts`
- Create: `Backend/src/crm/crm.module.ts`
- Modify: `Backend/src/app.module.ts`
- Test: `Backend/src/crm/tasks.service.test.ts`

**Interfaces:**
- Consumes: `primaryFor`, `ROLE_RANK`, `PrismaService`.
- Produces:
  ```ts
  // crm.settings.ts
  export interface RoutingPlan { designation: string | null; autoAssign: boolean; autoTask: boolean; taskDueHours: number }
  export interface SettingsView { leadDesignation: string | null; effectiveDesignation: string | null; autoAssign: boolean; autoTask: boolean; taskDueHours: number; designations: string[] }
  export class CrmSettingsService {
    plan(workspaceId: string): Promise<RoutingPlan>;
    read(claims: AuthClaims): Promise<SettingsView>;
    save(claims: AuthClaims, dto: CrmSettingsDto): Promise<SettingsView>;
  }
  // tasks.service.ts
  export interface TaskView { id: string; title: string; note: string | null; dueAt: string | null; status: FollowUpStatus; completedAt: string | null; overdue: boolean; conversationId: string; contact: { id: string; name: string | null; waId: string } | null; assignedTo: { id: string; name: string | null } | null }
  export class TasksService {
    create(input: { workspaceId: string; conversationId: string; title: string; note: string | null; dueAt: Date | null; assignedToUserId: string | null }): Promise<string | null>;
    list(claims: AuthClaims, scope: "mine" | "all"): Promise<{ tasks: TaskView[] }>;
    update(claims: AuthClaims, id: string, dto: UpdateTaskDto): Promise<{ task: TaskView }>;
    waLink(claims: AuthClaims, id: string): Promise<{ url: string; text: string }>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `Backend/src/crm/tasks.service.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import type { PrismaService } from "../prisma/prisma.service";
import type { WorkspacesService } from "../workspaces/workspaces.service";
import { TasksService } from "./tasks.service";

const claims = { id: "user-1", email: "one@test.dev" } as AuthClaims;

const task = {
  id: "task-1",
  title: "Follow up with Dosa",
  note: "Interested: matched",
  dueAt: new Date("2026-11-28T10:00:00Z"),
  status: "OPEN" as const,
  completedAt: null,
  conversationId: "c-1",
  assignedTo: { id: "user-1", fullName: "One" },
  conversation: { contact: { id: "contact-1", profileName: "Dosa", waId: "919900000000" } },
};

function service(role: "OWNER" | "ADMIN" | "MANAGER" | "AGENT") {
  const created: unknown[] = [];
  const prisma = {
    followUpTask: {
      findFirst: async () => null,
      create: async (args: { data: unknown }) => {
        created.push(args.data);
        return { id: "task-1" };
      },
      findMany: async () => [task],
      update: async () => task,
    },
    workspaceMember: {
      findUnique: async () => ({ personalWhatsApp: "919876543210", user: { fullName: "One Two" } }),
    },
    workspace: { findUniqueOrThrow: async () => ({ name: "Dosa Corner" }) },
    internalNote: { create: async () => ({ id: "note-1" }) },
  } as unknown as PrismaService;

  const workspaces = {
    primaryFor: async () => ({ userId: "user-1", workspaceId: "ws-1", role }),
  } as unknown as WorkspacesService;

  return { tasks: new TasksService(prisma, workspaces), created };
}

const input = {
  workspaceId: "ws-1",
  conversationId: "c-1",
  title: "Follow up with Dosa",
  note: "interested",
  dueAt: new Date("2026-11-28T10:00:00Z"),
  assignedToUserId: "user-2",
};

test("a task is created with the values it was given", async () => {
  const { tasks, created } = service("OWNER");

  assert.equal(await tasks.create(input), "task-1");
  assert.deepEqual(created[0], input);
});

test("an open task already on the thread is not created twice", async () => {
  const { tasks, created } = service("OWNER");
  (tasks as unknown as { prisma: { followUpTask: { findFirst: () => Promise<unknown> } } }).prisma.followUpTask.findFirst =
    async () => ({ id: "existing" });

  assert.equal(await tasks.create(input), null);
  assert.equal(created.length, 0);
});

test("a partial-index race is swallowed, not thrown at the webhook", async () => {
  const { tasks } = service("OWNER");
  (tasks as unknown as { prisma: { followUpTask: { create: () => Promise<unknown> } } }).prisma.followUpTask.create =
    async () => {
      throw Object.assign(new Error("duplicate key"), { code: "P2002" });
    };

  assert.equal(await tasks.create(input), null);
});

test("an agent reads only their own tasks", async () => {
  const { tasks } = service("AGENT");
  const listed = await tasks.list(claims, "mine");

  assert.equal(listed.tasks[0].id, "task-1");
  assert.equal(listed.tasks[0].overdue, true);
});

test("an agent may not ask for the whole workspace's tasks", async () => {
  const { tasks } = service("AGENT");

  await assert.rejects(() => tasks.list(claims, "all"), (error: unknown) => {
    assert.ok(error instanceof ForbiddenException);
    assert.equal((error.getResponse() as { code: string }).code, "SCOPE_FORBIDDEN");
    return true;
  });
});

test("an agent may not touch a task that is not theirs", async () => {
  const { tasks } = service("AGENT");
  (tasks as unknown as { prisma: { followUpTask: { findFirst: () => Promise<unknown> } } }).prisma.followUpTask.findFirst =
    async () => ({ ...task, assignedToUserId: "user-2" });

  await assert.rejects(
    () => tasks.update(claims, "task-1", { status: "DONE" }),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      assert.equal((error.getResponse() as { code: string }).code, "TASK_NOT_YOURS");
      return true;
    },
  );
});

test("a link is built from the member's own number and the workspace's name", async () => {
  const { tasks } = service("AGENT");

  const link = await tasks.waLink(claims, "task-1");

  assert.equal(link.url.startsWith("https://wa.me/919876543210?text="), true);
  const text = decodeURIComponent(link.url.split("text=")[1]);
  assert.equal(text.includes("Dosa Corner"), true);
  assert.equal(text.includes("One"), true);
  // The internal classifier reason never reaches the customer.
  assert.equal(text.includes("Interested:"), false);
});

test("a task from another workspace answers 404, not 403", async () => {
  const { tasks } = service("OWNER");
  (tasks as unknown as { prisma: { followUpTask: { findFirst: () => Promise<unknown> } } }).prisma.followUpTask.findFirst =
    async () => null;

  await assert.rejects(() => tasks.update(claims, "task-1", { status: "DONE" }), NotFoundException);
});
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd Backend; npm test`
Expected: FAIL — `Cannot find module './tasks.service'`.

- [ ] **Step 3: Write the DTOs**

Create `Backend/src/crm/crm.dto.ts`:

```ts
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export const INTEREST_VALUES = ["UNKNOWN", "INTERESTED", "NOT_INTERESTED"] as const;
export const TASK_STATUSES = ["OPEN", "DONE", "CANCELLED"] as const;
export const TASK_SCOPES = ["mine", "all"] as const;

export type InterestValue = (typeof INTEREST_VALUES)[number];
export type TaskStatusValue = (typeof TASK_STATUSES)[number];

/** A manager's decision about one lead. */
export class SetInterestDto {
  @IsIn(INTEREST_VALUES)
  interest!: InterestValue;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatusValue;

  /** ISO-8601, or null to clear the deadline. */
  @IsOptional()
  @IsISO8601()
  dueAt?: string | null;
}

export class ListTasksDto {
  @IsOptional()
  @IsIn(TASK_SCOPES)
  scope?: "mine" | "all";
}

export class CrmSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  leadDesignation?: string | null;

  @IsOptional()
  @IsBoolean()
  autoAssign?: boolean;

  @IsOptional()
  @IsBoolean()
  autoTask?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  taskDueHours?: number;
}
```

- [ ] **Step 4: Write the settings service**

Create `Backend/src/crm/crm.settings.ts`:

```ts
import { Injectable } from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { CrmSettingsDto } from "./crm.dto";

/** What intake follows, defaults already filled in. */
export interface RoutingPlan {
  /** The designation leads rotate to, or null when none can be resolved. */
  designation: string | null;
  autoAssign: boolean;
  autoTask: boolean;
  taskDueHours: number;
}

export interface SettingsView {
  /** What the owner stored. Null means "not chosen", which the screen says. */
  leadDesignation: string | null;
  /** What rotation actually uses, including the single-designation fallback. */
  effectiveDesignation: string | null;
  autoAssign: boolean;
  autoTask: boolean;
  taskDueHours: number;
  /** Every designation on the roster, so the screen offers real choices. */
  designations: string[];
}

const DEFAULTS = { leadDesignation: null, autoAssign: true, autoTask: true, taskDueHours: 24 };

@Injectable()
export class CrmSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /**
   * The designations a lead can rotate to. The owner is left out: they run the
   * workspace, and rotating them in would quietly take leads from the people
   * hired for them.
   */
  async designations(workspaceId: string): Promise<string[]> {
    const rows = await this.prisma.workspaceMember.groupBy({
      by: ["designation"],
      where: {
        workspaceId,
        role: { not: "OWNER" },
        designation: { not: null },
      },
    });

    return rows
      .map((row) => row.designation)
      .filter((value): value is string => Boolean(value?.trim()))
      .sort((left, right) => left.localeCompare(right));
  }

  /**
   * The plan intake follows. A stored designation wins; otherwise, when the
   * roster carries exactly one, that one; otherwise nothing, and the lead
   * stays unassigned rather than guessing.
   */
  async plan(workspaceId: string): Promise<RoutingPlan> {
    const stored = await this.prisma.crmSettings.findUnique({
      where: { workspaceId },
      select: {
        leadDesignation: true,
        autoAssign: true,
        autoTask: true,
        taskDueHours: true,
      },
    });

    const row = stored ?? DEFAULTS;
    let designation = row.leadDesignation?.trim() || null;

    if (!designation) {
      const roster = await this.designations(workspaceId);
      designation = roster.length === 1 ? roster[0] : null;
    }

    return {
      designation,
      autoAssign: row.autoAssign,
      autoTask: row.autoTask,
      taskDueHours: row.taskDueHours,
    };
  }

  async read(claims: AuthClaims): Promise<SettingsView> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const [plan, designations] = await Promise.all([
      this.plan(workspaceId),
      this.designations(workspaceId),
    ]);

    return {
      leadDesignation: plan.designation && designations.length > 1 ? plan.designation : null,
      effectiveDesignation: plan.designation,
      autoAssign: plan.autoAssign,
      autoTask: plan.autoTask,
      taskDueHours: plan.taskDueHours,
      designations,
    };
  }

  async save(claims: AuthClaims, dto: CrmSettingsDto): Promise<SettingsView> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const data = {
      ...(dto.leadDesignation !== undefined
        ? { leadDesignation: dto.leadDesignation?.trim() || null }
        : {}),
      ...(dto.autoAssign !== undefined ? { autoAssign: dto.autoAssign } : {}),
      ...(dto.autoTask !== undefined ? { autoTask: dto.autoTask } : {}),
      ...(dto.taskDueHours !== undefined ? { taskDueHours: dto.taskDueHours } : {}),
    };

    await this.prisma.crmSettings.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data },
      update: data,
    });

    return this.read(claims);
  }
}
```

- [ ] **Step 5: Write the tasks service**

Create `Backend/src/crm/tasks.service.ts`:

```ts
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { FollowUpStatus, Prisma } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { ROLE_RANK } from "../workspaces/workspace-roles.decorator";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { UpdateTaskDto } from "./crm.dto";

const TASK_SELECT = {
  id: true,
  title: true,
  note: true,
  dueAt: true,
  status: true,
  completedAt: true,
  conversationId: true,
  assignedTo: { select: { id: true, fullName: true } },
  conversation: {
    select: { contact: { select: { id: true, profileName: true, waId: true } } },
  },
} satisfies Prisma.FollowUpTaskSelect;

export type TaskSource = Prisma.FollowUpTaskGetPayload<{ select: typeof TASK_SELECT }>;

export interface TaskView {
  id: string;
  title: string;
  note: string | null;
  dueAt: string | null;
  status: FollowUpStatus;
  completedAt: string | null;
  /** True once the deadline has passed and the task is still open. */
  overdue: boolean;
  conversationId: string;
  contact: { id: string; name: string | null; waId: string } | null;
  assignedTo: { id: string; name: string | null } | null;
}

export function taskView(row: TaskSource, now = Date.now()): TaskView {
  const due = row.dueAt;

  return {
    id: row.id,
    title: row.title,
    note: row.note,
    dueAt: due ? due.toISOString() : null,
    status: row.status,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    overdue: row.status === "OPEN" && due !== null && due.getTime() < now,
    conversationId: row.conversationId,
    contact: row.conversation.contact
      ? {
          id: row.conversation.contact.id,
          name: row.conversation.contact.profileName,
          waId: row.conversation.contact.waId,
        }
      : null,
    assignedTo: row.assignedTo
      ? { id: row.assignedTo.id, name: row.assignedTo.fullName }
      : null,
  };
}

/**
 * Follow-up tasks: one open task per thread, created only here so the dedupe
 * has a single home.
 *
 * Not a `$transaction`: the partial unique index and the read below converge
 * on the same answer from a retried delivery, which is what idempotency needs.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /** Returns the new id, or null when the thread already has an open task. */
  async create(input: {
    workspaceId: string;
    conversationId: string;
    title: string;
    note: string | null;
    dueAt: Date | null;
    assignedToUserId: string | null;
  }): Promise<string | null> {
    const open = await this.prisma.followUpTask.findFirst({
      where: { conversationId: input.conversationId, status: "OPEN" },
      select: { id: true },
    });

    if (open) return null;

    try {
      const created = await this.prisma.followUpTask.create({
        data: input,
        select: { id: true },
      });

      return created.id;
    } catch (error) {
      // Two deliveries in the same instant: the index picks one, and the loser
      // treats it as "already handled" rather than failing the webhook.
      if ((error as { code?: string }).code === "P2002") return null;
      throw error;
    }
  }

  async list(
    claims: AuthClaims,
    scope: "mine" | "all",
  ): Promise<{ tasks: TaskView[] }> {
    const { workspaceId, userId, role } = await this.workspaces.primaryFor(claims);

    if (scope === "all" && ROLE_RANK[role] < ROLE_RANK.MANAGER) {
      throw new ForbiddenException({
        code: "SCOPE_FORBIDDEN",
        message: "Only a manager reads every follow-up in the workspace.",
      });
    }

    const rows = await this.prisma.followUpTask.findMany({
      where:
        scope === "mine"
          ? { workspaceId, assignedToUserId: userId, status: "OPEN" }
          : { workspaceId, status: "OPEN" },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: 200,
      select: TASK_SELECT,
    });

    return { tasks: rows.map((row) => taskView(row)) };
  }

  async update(
    claims: AuthClaims,
    id: string,
    dto: UpdateTaskDto,
  ): Promise<{ task: TaskView }> {
    const { workspaceId, userId, role } = await this.workspaces.primaryFor(claims);

    const task = await this.prisma.followUpTask.findFirst({
      where: { id, workspaceId },
      select: { id: true, assignedToUserId: true },
    });

    if (!task) {
      throw new NotFoundException({ code: "TASK_MISSING", message: "Unknown task." });
    }

    if (
      role === "AGENT" &&
      task.assignedToUserId !== null &&
      task.assignedToUserId !== userId
    ) {
      throw new ForbiddenException({
        code: "TASK_NOT_YOURS",
        message: "That follow-up belongs to somebody else.",
      });
    }

    const data: Prisma.FollowUpTaskUpdateInput = {};

    if (dto.dueAt !== undefined) {
      data.dueAt = dto.dueAt === null ? null : new Date(dto.dueAt);
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
      // Nobody did the work on a cancelled task, so it carries no stamp.
      data.completedAt = dto.status === "DONE" ? new Date() : null;
    }

    await this.prisma.followUpTask.update({ where: { id: task.id }, data });

    const row = await this.prisma.followUpTask.findUniqueOrThrow({
      where: { id: task.id },
      select: TASK_SELECT,
    });

    return { task: taskView(row) };
  }

  /**
   * The `wa.me` link for a follow-up, built on the server so the wording is one
   * place.
   *
   * This is the only way to message from a personal number: only a number
   * registered to the workspace's WABA can send through the Cloud API. Nothing
   * confirms delivery, and the reply lands on the member's phone rather than in
   * this inbox — the screen says so.
   */
  async waLink(claims: AuthClaims, id: string): Promise<{ url: string; text: string }> {
    const { workspaceId, userId } = await this.workspaces.primaryFor(claims);

    const task = await this.prisma.followUpTask.findFirst({
      where: { id, workspaceId },
      select: {
        id: true,
        conversationId: true,
        assignedToUserId: true,
        conversation: {
          select: { contact: { select: { profileName: true, waId: true } } },
        },
      },
    });

    if (!task) {
      throw new NotFoundException({ code: "TASK_MISSING", message: "Unknown task." });
    }

    if (task.assignedToUserId !== userId) {
      throw new ForbiddenException({
        code: "TASK_NOT_YOURS",
        message: "That follow-up belongs to somebody else.",
      });
    }

    const [member, workspace] = await Promise.all([
      this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { personalWhatsApp: true, user: { select: { fullName: true } } },
      }),
      this.prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { name: true },
      }),
    ]);

    const digits = member?.personalWhatsApp ?? "";

    if (!/^\d{8,15}$/.test(digits)) {
      throw new ConflictException({
        code: "NO_PERSONAL_NUMBER",
        message: "Ask the workspace owner to add your WhatsApp number on the Team screen.",
      });
    }

    const contact = task.conversation.contact;
    const greeting = contact?.profileName?.trim() || "there";
    const agent = member?.user.fullName?.trim().split(/\s+/)[0] || "our team";
    const text = `Hi ${greeting}, ${agent} from ${workspace.name} here about your enquiry. Is now a good time to talk?`;
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;

    // The thread records what actually happened: a customer writing back will
    // read this note beside their own messages.
    await this.prisma.internalNote.create({
      data: {
        conversationId: task.conversationId,
        authorUserId: userId,
        body: `Follow-up on personal WhatsApp: ${text}`,
      },
    });

    return { url, text };
  }
}
```

- [ ] **Step 6: Write the controller**

Create `Backend/src/crm/crm.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { RequiresModule, Roles } from "../workspaces/workspace-roles.decorator";
import { WorkspaceRolesGuard } from "../workspaces/workspace-roles.guard";
import { CrmSettingsDto, ListTasksDto, UpdateTaskDto } from "./crm.dto";
import { CrmSettingsService } from "./crm.settings";
import { TasksService } from "./tasks.service";

/**
 * The CRM's HTTP surface.
 *
 * Tasks sit behind `inbox`, not `crm`: an agent's own follow-ups must not need
 * the pipeline module. Every route resolves its workspace from the token, so an
 * id from another tenant answers 404 exactly like a missing one.
 */
@Controller("v1/crm")
@UseGuards(SupabaseAuthGuard, WorkspaceRolesGuard)
export class CrmController {
  constructor(
    private readonly settings: CrmSettingsService,
    private readonly tasks: TasksService,
  ) {}

  /** GET /api/v1/crm/tasks?scope=mine|all — open follow-ups, soonest first. */
  @Get("tasks")
  @RequiresModule("inbox")
  listTasks(@CurrentUser() claims: AuthClaims, @Query() query: ListTasksDto) {
    return this.tasks.list(claims, query.scope ?? "mine");
  }

  /** PATCH /api/v1/crm/tasks/:id — the deadline or the status. */
  @Patch("tasks/:id")
  @RequiresModule("inbox")
  updateTask(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(claims, id, dto);
  }

  /**
   * POST /api/v1/crm/tasks/:id/wa-link — the member's personal WhatsApp link.
   * 409 `NO_PERSONAL_NUMBER` when the owner has not set one.
   */
  @Post("tasks/:id/wa-link")
  @RequiresModule("inbox")
  waLink(@CurrentUser() claims: AuthClaims, @Param("id", ParseUUIDPipe) id: string) {
    return this.tasks.waLink(claims, id);
  }

  /** GET /api/v1/crm/settings — the owner's routing, and the roster's titles. */
  @Get("settings")
  @Roles("OWNER")
  readSettings(@CurrentUser() claims: AuthClaims) {
    return this.settings.read(claims);
  }

  /** PUT /api/v1/crm/settings — designation, the two switches, due hours. */
  @Put("settings")
  @Roles("OWNER")
  saveSettings(@CurrentUser() claims: AuthClaims, @Body() dto: CrmSettingsDto) {
    return this.settings.save(claims, dto);
  }
}
```

- [ ] **Step 7: Write the module and wire it**

Create `Backend/src/crm/crm.module.ts`:

```ts
import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CrmController } from "./crm.controller";
import { CrmSettingsService } from "./crm.settings";
import { TasksService } from "./tasks.service";

/**
 * Leads, follow-up tasks and the routing settings.
 *
 * `AuthModule` supplies the guard and `WorkspacesModule` the tenant every route
 * resolves from the token. `LeadIntake` is added in a later task and exported
 * because the WhatsApp webhook — a different module — is the only writer.
 */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [CrmController],
  providers: [CrmSettingsService, TasksService],
  exports: [CrmSettingsService, TasksService],
})
export class CrmModule {}
```

In `Backend/src/app.module.ts`, import it and add `CrmModule,` after `BusinessModule,` in `imports`.

- [ ] **Step 8: Run the tests and the gates**

Run: `cd Backend; npm test; npm run typecheck; npx nest build`
Expected: the eight task tests pass; no type errors; the build completes.

- [ ] **Step 9: Checkpoint**

Run: `cd Backend; git status --short`
Expected: five new files plus `app.module.ts`. Do not commit.

---

### Task 7: The pipeline and the manual override

**Files:**
- Create: `Backend/src/crm/crm.pipeline.ts`
- Create: `Backend/src/crm/crm.service.ts`
- Modify: `Backend/src/crm/crm.controller.ts`
- Modify: `Backend/src/crm/crm.module.ts`
- Test: `Backend/src/crm/crm.pipeline.test.ts`

**Interfaces:**
- Consumes: `CONVERSATION_SELECT`, `conversationView`, `ConversationView` from `../inbox/inbox.view`.
- Produces:
  ```ts
  export type BoardColumn = "NEW" | "INTERESTED" | "FOLLOW_UP" | "NOT_INTERESTED";
  export const BOARD_COLUMNS: readonly { key: BoardColumn; label: string }[];
  export function columnOf(row: { interest: LeadInterest; openTask: { id: string } | null }): BoardColumn;
  // crm.service.ts
  export interface PipelineView {
    columns: { key: BoardColumn; label: string; rows: ConversationView[] }[];
    counts: Record<BoardColumn, number>;
    total: number;
  }
  export class CrmService {
    pipeline(claims: AuthClaims, interest?: LeadInterest): Promise<PipelineView>;
    setInterest(claims: AuthClaims, conversationId: string, interest: LeadInterest): Promise<{ ok: true }>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `Backend/src/crm/crm.pipeline.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { columnOf } from "./crm.pipeline";

test("a thread nobody has read is New", () => {
  assert.equal(columnOf({ interest: "UNKNOWN", openTask: null }), "NEW");
});

test("interested with no task is Interested", () => {
  assert.equal(columnOf({ interest: "INTERESTED", openTask: null }), "INTERESTED");
});

test("interested with an open task is Follow-up", () => {
  assert.equal(columnOf({ interest: "INTERESTED", openTask: { id: "task-1" } }), "FOLLOW_UP");
});

test("a refusal leaves the active board", () => {
  assert.equal(
    columnOf({ interest: "NOT_INTERESTED", openTask: { id: "task-1" } }),
    "NOT_INTERESTED",
  );
});
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd Backend; npm test`
Expected: FAIL — `Cannot find module './crm.pipeline'`.

- [ ] **Step 3: Write the column derivation**

Create `Backend/src/crm/crm.pipeline.ts`:

```ts
import type { LeadInterest } from "@prisma/client";

/** The board's columns, in the order the screen draws them. */
export type BoardColumn = "NEW" | "INTERESTED" | "FOLLOW_UP" | "NOT_INTERESTED";

export const BOARD_COLUMNS: readonly { key: BoardColumn; label: string }[] = [
  { key: "NEW", label: "New" },
  { key: "INTERESTED", label: "Interested" },
  { key: "FOLLOW_UP", label: "Follow-up" },
  { key: "NOT_INTERESTED", label: "Not interested" },
];

/**
 * A conversation's column, derived from what is stored rather than kept in a
 * second field: a stale column is a bug a board cannot recover from.
 */
export function columnOf(row: {
  interest: LeadInterest;
  openTask: { id: string } | null;
}): BoardColumn {
  if (row.interest === "NOT_INTERESTED") return "NOT_INTERESTED";
  if (row.interest === "INTERESTED") return row.openTask ? "FOLLOW_UP" : "INTERESTED";
  return "NEW";
}
```

- [ ] **Step 4: Write the service**

Create `Backend/src/crm/crm.service.ts`:

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import type { LeadInterest, Prisma } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { CONVERSATION_SELECT, conversationView, type ConversationView } from "../inbox/inbox.view";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { BOARD_COLUMNS, columnOf, type BoardColumn } from "./crm.pipeline";
import { MANUAL_REASON } from "./interest.rules";

export interface PipelineView {
  columns: { key: BoardColumn; label: string; rows: ConversationView[] }[];
  counts: Record<BoardColumn, number>;
  total: number;
}

/** A board of twenty leads is a board; a board of a thousand is a report. */
const BOARD_LIMIT = 200;

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async pipeline(claims: AuthClaims, interest?: LeadInterest): Promise<PipelineView> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const where: Prisma.ConversationWhereInput = { workspaceId };

    if (interest) where.interest = interest;

    const rows = await this.prisma.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: BOARD_LIMIT,
      select: CONVERSATION_SELECT,
    });

    const views = rows.map(conversationView);
    const buckets = new Map<BoardColumn, ConversationView[]>(
      BOARD_COLUMNS.map((column) => [column.key, []]),
    );

    for (const view of views) {
      buckets.get(columnOf(view))?.push(view);
    }

    const counts = Object.fromEntries(
      BOARD_COLUMNS.map((column) => [column.key, buckets.get(column.key)?.length ?? 0]),
    ) as Record<BoardColumn, number>;

    return {
      columns: BOARD_COLUMNS.map((column) => ({
        key: column.key,
        label: column.label,
        rows: buckets.get(column.key) ?? [],
      })),
      counts,
      total: views.length,
    };
  }

  /**
   * A manager's decision about one lead.
   *
   * `manual` is what stops intake reversing it for 24 hours: the customer's
   * next "ok" must not undo a person's call. A refusal also cancels the open
   * task, exactly as the classifier would.
   */
  async setInterest(
    claims: AuthClaims,
    conversationId: string,
    interest: LeadInterest,
  ): Promise<{ ok: true }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const updated = await this.prisma.conversation.updateMany({
      where: { id: conversationId, workspaceId },
      data: {
        interest,
        interestReason: MANUAL_REASON,
        interestAt: new Date(),
      },
    });

    if (updated.count === 0) {
      throw new NotFoundException({
        code: "CONVERSATION_MISSING",
        message: "Unknown conversation.",
      });
    }

    if (interest === "NOT_INTERESTED") {
      await this.prisma.followUpTask.updateMany({
        where: { conversationId, status: "OPEN" },
        data: { status: "CANCELLED" },
      });
    }

    return { ok: true };
  }
}
```

- [ ] **Step 5: Add the two routes**

In `Backend/src/crm/crm.controller.ts`, import `CrmService`, `SetInterestDto` and `INTEREST_VALUES`' type, add `Query` to the Nest import list (already there), inject the service, and add:

```ts
  /** GET /api/v1/crm/pipeline — the board, grouped by derived stage. */
  @Get("pipeline")
  @RequiresModule("crm")
  pipeline(@CurrentUser() claims: AuthClaims, @Query("interest") interest?: string) {
    return this.crm.pipeline(
      claims,
      (INTEREST_VALUES as readonly string[]).includes(interest ?? "")
        ? (interest as InterestValue)
        : undefined,
    );
  }

  /**
   * PUT /api/v1/crm/conversations/:id/interest — a manager's override.
   * Intake leaves a manual stage alone for 24 hours.
   */
  @Put("conversations/:id/interest")
  @RequiresModule("crm")
  @Roles("MANAGER")
  setInterest(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetInterestDto,
  ) {
    return this.crm.setInterest(claims, id, dto.interest);
  }
```

Add `CrmService` to the module's `providers` (it is controller-facing, so it need not be exported).

- [ ] **Step 6: Run the tests and the gates**

Run: `cd Backend; npm test; npm run typecheck; npx nest build`
Expected: the four column tests pass; no type errors; the build completes.

- [ ] **Step 7: Checkpoint**

Run: `cd Backend; git status --short`
Expected: three new files plus the controller and module. Do not commit.

---

### Task 8: Lead intake, wired into the webhook

**Files:**
- Create: `Backend/src/crm/lead.intake.ts`
- Modify: `Backend/src/crm/crm.module.ts` (provide + export `LeadIntake`)
- Modify: `Backend/src/whatsapp/whatsapp-webhook.service.ts`
- Modify: `Backend/src/whatsapp/whatsapp.module.ts`
- Test: `Backend/src/crm/lead.intake.test.ts`

**Interfaces:**
- Consumes: `classify`, `MANUAL_REASON`; `CrmSettingsService.plan()`; `RoundRobin.pick()`; `TasksService.create()`; `StoredInbound` from `../inbox/inbox.store`.
- Produces:
  ```ts
  export function tagsFor(tags: readonly string[], interest: LeadInterest): string[];
  export class LeadIntake {
    consider(account: { workspaceId: string }, stored: readonly StoredInbound[]): Promise<void>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `Backend/src/crm/lead.intake.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaService } from "../prisma/prisma.service";
import type { StoredInbound } from "../inbox/inbox.store";
import { CrmSettingsService } from "./crm.settings";
import { LeadIntake, tagsFor } from "./lead.intake";
import { RoundRobin } from "./round.robin";
import type { TasksService } from "./tasks.service";

const inbound: StoredInbound = {
  conversationId: "c-1",
  messageId: "m-1",
  kind: "TEXT",
  body: "how much is the price",
};

const conversation = {
  id: "c-1",
  interest: "UNKNOWN" as const,
  interestScore: null,
  interestReason: null,
  interestAt: null,
  assignedToUserId: null as string | null,
  contactId: "contact-1",
  contact: { tags: ["vip"], profileName: "Dosa", waId: "919900000000" },
};

function build(options: { assigned?: string | null; reason?: string | null } = {}) {
  const writes: Record<string, unknown>[] = [];
  const tasks: unknown[] = [];
  const prisma = {
    workspace: { findUniqueOrThrow: async () => ({ ownerId: "owner-1" }) },
    conversation: {
      findUnique: async () => ({
        ...conversation,
        assignedToUserId: options.assigned ?? null,
        interestReason: options.reason ?? null,
      }),
      update: async (args: Record<string, unknown>) => {
        writes.push(args);
        return conversation;
      },
      updateMany: async () => ({ count: 1 }),
    },
    contact: {
      update: async (args: Record<string, unknown>) => {
        writes.push(args);
        return conversation.contact;
      },
    },
    message: { findFirst: async () => ({ body: "hello" }) },
    followUpTask: {
      updateMany: async (args: Record<string, unknown>) => {
        writes.push(args);
        return { count: 1 };
      },
    },
  } as unknown as PrismaService;

  const settings = {
    plan: async () => ({ designation: "Sales", autoAssign: true, autoTask: true, taskDueHours: 24 }),
  } as unknown as CrmSettingsService;

  let picks = 0;
  const robin = {
    pick: async () => {
      picks += 1;
      return "user-2";
    },
  } as unknown as RoundRobin;

  let creates = 0;
  const taskService = {
    create: async (input: unknown) => {
      creates += 1;
      tasks.push(input);
      return "task-1";
    },
  } as unknown as TasksService;

  return {
    intake: new LeadIntake(prisma, settings, robin, taskService),
    writes,
    tasks,
    picks: () => picks,
    creates: () => creates,
  };
}

test("an interested lead is staged, tagged, assigned and given one task", async () => {
  const { intake, writes, tasks, picks, creates } = build();

  await intake.consider({ workspaceId: "ws-1" }, [inbound]);

  const stage = writes.find((row) => "data" in row && "interest" in (row.data as object));
  assert.equal((stage?.data as { interest: string }).interest, "INTERESTED");

  const tags = writes.find((row) => "data" in row && "tags" in (row.data as object));
  assert.deepEqual((tags?.data as { tags: string[] }).tags, ["vip", "interested"]);

  assert.equal(picks(), 1);
  assert.equal(creates(), 1);
  assert.equal((tasks[0] as { assignedToUserId: string }).assignedToUserId, "user-2");
});

test("a refusal cancels the open task and assigns nobody", async () => {
  const { intake, writes, picks, creates } = build();

  await intake.consider({ workspaceId: "ws-1" }, [
    { ...inbound, body: "stop messaging me" },
  ]);

  assert.equal(picks(), 0);
  assert.equal(creates(), 0);
  assert.equal(
    writes.some((row) => "where" in row && (row.where as { status?: string }).status === "OPEN"),
    true,
  );
});

test("a message with no signal writes the stage and nothing else", async () => {
  const { intake, picks, creates } = build();

  await intake.consider({ workspaceId: "ws-1" }, [{ ...inbound, body: "hello there" }]);

  assert.equal(picks(), 0);
  assert.equal(creates(), 0);
});

test("a thread that already has an assignee is never reassigned", async () => {
  const { intake, picks, creates } = build({ assigned: "user-9" });

  await intake.consider({ workspaceId: "ws-1" }, [inbound]);

  assert.equal(picks(), 0);
  assert.equal(creates(), 1);
});

test("a manual override is left alone", async () => {
  const { intake, writes, picks } = build({ reason: "manual" });

  await intake.consider({ workspaceId: "ws-1" }, [inbound]);

  assert.equal(writes.length, 0);
  assert.equal(picks(), 0);
});

test("a failing write is swallowed, never raised at the webhook", async () => {
  const { intake } = build();
  (intake as unknown as { prisma: { conversation: { findUnique: () => Promise<never> } } }).prisma.conversation.findUnique =
    async () => {
      throw new Error("database is down");
    };

  await intake.consider({ workspaceId: "ws-1" }, [inbound]);
});

test("a non-text message is skipped", async () => {
  const { intake, writes } = build();

  await intake.consider({ workspaceId: "ws-1" }, [{ ...inbound, kind: "IMAGE", body: null }]);

  assert.equal(writes.length, 0);
});

test("tags keep what the contact already carried", () => {
  assert.deepEqual(tagsFor(["vip", "not-interested"], "INTERESTED"), ["vip", "interested"]);
  assert.deepEqual(tagsFor(["vip"], "UNKNOWN"), ["vip"]);
});
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd Backend; npm test`
Expected: FAIL — `Cannot find module './lead.intake'`.

- [ ] **Step 3: Write the intake**

Create `Backend/src/crm/lead.intake.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import type { LeadInterest } from "@prisma/client";

import type { StoredInbound } from "../inbox/inbox.store";
import { PrismaService } from "../prisma/prisma.service";
import { CrmSettingsService } from "./crm.settings";
import { MANUAL_REASON, NO_SIGNAL, classify } from "./interest.rules";
import { RoundRobin } from "./round.robin";
import { TasksService } from "./tasks.service";

/** How long a manager's decision outranks the classifier. */
export const MANUAL_FREEZE_MS = 24 * 60 * 60 * 1000;

/**
 * The contact tags a stage implies. The old tag is replaced rather than
 * stacked, so a thread that swings twice does not read as both.
 */
export function tagsFor(tags: readonly string[], interest: LeadInterest): string[] {
  const keep = tags.filter((tag) => tag !== "interested" && tag !== "not-interested");

  if (interest === "INTERESTED") return [...keep, "interested"];
  if (interest === "NOT_INTERESTED") return [...keep, "not-interested"];
  return keep;
}

/**
 * Reads each newly stored inbound message and acts on it.
 *
 * Called beside the AI intake, immediately after `InboxStore.record()`, and
 * never allowed to throw: a CRM bug must not make Meta retry a message that is
 * already stored. Idempotency comes from the data — only rows in `StoredInbound`
 * are considered, an existing assignee is never overwritten, and one open task
 * per thread is enforced by a partial unique index.
 */
@Injectable()
export class LeadIntake {
  private readonly logger = new Logger(LeadIntake.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CrmSettingsService,
    private readonly robin: RoundRobin,
    private readonly tasks: TasksService,
  ) {}

  async consider(
    account: { workspaceId: string },
    stored: readonly StoredInbound[],
  ): Promise<void> {
    const rows = stored.filter((row) => row.kind === "TEXT" && row.body?.trim());

    if (rows.length === 0) return;

    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: account.workspaceId },
      select: { ownerId: true },
    });
    const plan = await this.settings.plan(account.workspaceId);

    for (const row of rows) {
      try {
        await this.apply(account.workspaceId, workspace.ownerId, row, plan);
      } catch (error) {
        this.logger.error(
          `Could not classify a lead for workspace ${account.workspaceId}: ${
            error instanceof Error ? error.message : "unknown failure"
          }`,
        );
      }
    }
  }

  private async apply(
    workspaceId: string,
    ownerId: string,
    row: StoredInbound,
    plan: { designation: string | null; autoAssign: boolean; autoTask: boolean; taskDueHours: number },
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: row.conversationId },
      select: {
        id: true,
        interest: true,
        interestScore: true,
        interestReason: true,
        interestAt: true,
        assignedToUserId: true,
        contactId: true,
        contact: { select: { tags: true, profileName: true, waId: true } },
      },
    });

    if (!conversation || conversation.contact === null) return;

    // A person's call outranks a rule for one day. The customer's next "ok"
    // must not undo it.
    const manualAt = conversation.interestReason === MANUAL_REASON ? conversation.interestAt : null;

    if (manualAt && Date.now() - manualAt.getTime() < MANUAL_FREEZE_MS) return;

    const previous = await this.prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        direction: "INBOUND",
        id: { not: row.messageId },
        body: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { body: true },
    });

    const verdict = classify(row.body ?? "", {
      stage: conversation.interest,
      score: conversation.interestScore,
      body: previous?.body ?? null,
      reason: conversation.interestReason,
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        interest: verdict.interest,
        interestScore: verdict.score,
        interestReason: verdict.reason,
        interestAt: new Date(),
      },
    });

    await this.prisma.contact.update({
      where: { id: conversation.contactId },
      data: { tags: tagsFor(conversation.contact.tags, verdict.interest) },
    });

    if (verdict.interest === "NOT_INTERESTED") {
      // The thread stays in the inbox as history; only the errand ends.
      await this.prisma.followUpTask.updateMany({
        where: { conversationId: conversation.id, status: "OPEN" },
        data: { status: "CANCELLED" },
      });

      return;
    }

    if (verdict.interest !== "INTERESTED") return;

    let assignee = conversation.assignedToUserId;

    if (!assignee && plan.autoAssign && plan.designation) {
      const picked = await this.robin.pick(workspaceId, plan.designation);

      if (picked) {
        // `assignedToUserId: null` makes a racing manual assignment win.
        const claimed = await this.prisma.conversation.updateMany({
          where: { id: conversation.id, assignedToUserId: null },
          data: { assignedToUserId: picked },
        });

        if (claimed.count > 0) assignee = picked;
      }
    }

    if (!plan.autoTask) return;

    const name = conversation.contact.profileName ?? conversation.contact.waId;

    await this.tasks.create({
      workspaceId,
      conversationId: conversation.id,
      title: `Follow up with ${name}`,
      note: `Interested: ${verdict.reason === NO_SIGNAL ? "signals over time" : verdict.reason}`,
      dueAt: new Date(Date.now() + plan.taskDueHours * 60 * 60 * 1000),
      // Nobody to rotate to is not a reason to lose the errand: the owner
      // carries it, and the strip names them like anybody else.
      assignedToUserId: assignee ?? ownerId,
    });
  }
}
```

- [ ] **Step 4: Provide and export it**

In `Backend/src/crm/crm.module.ts`, add `LeadIntake` to `providers` and `exports`, and to the imports:

```ts
import { LeadIntake } from "./lead.intake";
import { RoundRobin } from "./round.robin";
```

```ts
  providers: [CrmSettingsService, TasksService, LeadIntake, RoundRobin],
  exports: [CrmSettingsService, TasksService, LeadIntake],
```

- [ ] **Step 5: Call it from the webhook**

In `Backend/src/whatsapp/whatsapp-webhook.service.ts`, import `LeadIntake` from `../crm/lead.intake`, inject it in the constructor (`private readonly leads: LeadIntake,`), and immediately after the `store.record(...)` result is bound:

```ts
        // A CRM failure must never answer Meta with 500 for a message that is
        // already stored: a retry cannot fix a classification.
        try {
          await this.leads.consider({ workspaceId: account.workspaceId }, stored);
        } catch (error) {
          this.logger.error(
            `Could not classify leads for ${account.phoneNumberId}: ${
              error instanceof Error ? error.message : "unknown failure"
            }`,
          );
        }
```

In `Backend/src/whatsapp/whatsapp.module.ts`, add `CrmModule` to `imports` and to the import list at the top.

- [ ] **Step 6: Run the tests and the gates**

Run: `cd Backend; npm test; npm run typecheck; npx nest build`
Expected: the eight intake tests pass; no type errors; the build completes with `CrmModule` resolved.

- [ ] **Step 7: Checkpoint**

Run: `cd Backend; git status --short`
Expected: two new files plus three modified. Do not commit.

---

### Task 9: The inbox reads the stage and the open task

**Files:**
- Modify: `Backend/src/inbox/dto/list-conversations.dto.ts`
- Modify: `Backend/src/inbox/inbox.view.ts`
- Modify: `Backend/src/inbox/inbox.service.ts`
- Modify: `Backend/src/inbox/inbox.queue.test.ts`
- Test: `Backend/src/inbox/inbox.queue.test.ts` (extend)

**Interfaces:**
- Consumes: `LeadInterest`, `FollowUpStatus` from `@prisma/client`.
- Produces on `ConversationView`: `interest`, `interestScore`, `interestReason`, `interestAt`, `openTask: { id; title; dueAt; status } | null`.

- [ ] **Step 1: Extend the queue test first**

In `Backend/src/inbox/inbox.queue.test.ts`, extend the `row` fixture so the view can read the new fields:

```ts
  interest: "UNKNOWN" as const,
  interestScore: null,
  interestReason: null,
  interestAt: null,
  followUpTasks: [],
```

Add one test at the end:

```ts
test("a stage filter narrows the queue like the status filter", async () => {
  const { inbox, lastQuery } = service("MANAGER");

  await inbox.list(claims, { interest: "INTERESTED" } as ListConversationsDto);

  assert.equal((lastQuery() as { interest?: string }).interest, "INTERESTED");
});
```

- [ ] **Step 2: Run it to watch it fail**

Run: `cd Backend; npm test`
Expected: FAIL — `interest` is not a property of `ListConversationsDto`, and `conversationView` cannot read `followUpTasks`.

- [ ] **Step 3: Add the filter to the DTO**

In `Backend/src/inbox/dto/list-conversations.dto.ts`, add after `status`:

```ts
  /** One stage, when the queue is being read as a lead list. */
  @IsOptional()
  @IsIn(["UNKNOWN", "INTERESTED", "NOT_INTERESTED"])
  interest?: "UNKNOWN" | "INTERESTED" | "NOT_INTERESTED";
```

- [ ] **Step 4: Add the fields to the selection and the view**

In `Backend/src/inbox/inbox.view.ts`, add to `CONVERSATION_SELECT` after `status`:

```ts
  interest: true,
  interestScore: true,
  interestReason: true,
  interestAt: true,
  /**
   * The one open follow-up, if any. Served by the partial unique index on
   * `follow_up_tasks (conversation_id) where status = 'OPEN'`, so a hundred
   * rows still cost one query.
   */
  followUpTasks: {
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, title: true, dueAt: true, status: true },
  },
```

Add to `ConversationView`, after `status`:

```ts
  /** What the customer's words said about buying. */
  interest: LeadInterest;
  /** The evidence behind the stage, for the tooltip. */
  interestScore: number | null;
  interestReason: string | null;
  interestAt: string | null;
  /** The open follow-up, so the thread can offer it without a second read. */
  openTask: { id: string; title: string; dueAt: string | null; status: FollowUpStatus } | null;
```

Change the type import at the top to include both enums:

```ts
import type {
  ConversationStatus,
  FollowUpStatus,
  LeadInterest,
  MessageDirection,
  MessageKind,
  MessageStatus,
  Prisma,
} from "@prisma/client";
```

and in `conversationView`, after `status: row.status,`:

```ts
    interest: row.interest,
    interestScore: row.interestScore,
    interestReason: row.interestReason,
    interestAt: iso(row.interestAt),
    openTask: row.followUpTasks[0]
      ? {
          id: row.followUpTasks[0].id,
          title: row.followUpTasks[0].title,
          dueAt: iso(row.followUpTasks[0].dueAt),
          status: row.followUpTasks[0].status,
        }
      : null,
```

- [ ] **Step 5: Add the where clause**

In `Backend/src/inbox/inbox.service.ts`, in `list()`, after the `status` line:

```ts
    if (query.interest) where.interest = query.interest;
```

- [ ] **Step 6: Run the tests and the gates**

Run: `cd Backend; npm test; npm run typecheck; npx nest build`
Expected: the new filter test passes, the existing queue tests still pass, no type errors.

- [ ] **Step 7: Checkpoint**

Run: `cd Backend; git status --short`
Expected: four modified files. Do not commit.

---

### Task 10: The Leads screen

**Files:**
- Create: `frontend/src/features/crm/api.ts`
- Create: `frontend/src/features/crm/components/pipeline-board.tsx`
- Create: `frontend/src/features/crm/components/task-list.tsx`
- Create: `frontend/src/features/crm/components/routing-settings.tsx`
- Create: `frontend/src/features/crm/components/crm-view.tsx`
- Create: `frontend/src/app/(app)/workspace/crm/page.tsx`
- Modify: `frontend/src/config/workspace-nav.ts`

**Interfaces:**
- Consumes: `GET /v1/crm/pipeline` → `PipelineView`; `PUT /v1/crm/conversations/:id/interest` → `{ ok: true }`; `GET /v1/crm/tasks?scope=mine|all` → `{ tasks: TaskView[] }`; `PATCH /v1/crm/tasks/:id`; `POST /v1/crm/tasks/:id/wa-link` → `{ url, text }`; `GET`/`PUT /v1/crm/settings` → `SettingsView` (all five shapes are fixed in Tasks 6 and 7); `useAccess()` from `@/components/workspace/access-provider`; `PageHeader`; `getNavItem`.
- Produces:
  ```ts
  // features/crm/api.ts
  export type LeadInterest = "UNKNOWN" | "INTERESTED" | "NOT_INTERESTED";
  export type FollowUpStatus = "OPEN" | "DONE" | "CANCELLED";
  export type BoardColumn = "NEW" | "INTERESTED" | "FOLLOW_UP" | "NOT_INTERESTED";
  export const INTEREST_VALUES: readonly LeadInterest[];
  export const INTEREST_LABELS: Record<LeadInterest, string>;
  export interface FollowUpTaskRef { id: string; title: string; dueAt: string | null; status: FollowUpStatus }
  export interface FollowUpTask extends FollowUpTaskRef {
    note: string | null; completedAt: string | null; overdue: boolean; conversationId: string;
    contact: { id: string; name: string | null; waId: string } | null;
    assignedTo: { id: string; name: string | null } | null;
  }
  export interface Lead {
    id: string; status: "OPEN" | "PENDING" | "CLOSED";
    contact: { id: string; waId: string; name: string | null };
    assignedTo: { id: string; name: string | null } | null;
    lastMessageAt: string; lastMessagePreview: string | null; unreadCount: number;
    interest: LeadInterest; interestScore: number | null; interestReason: string | null;
    interestAt: string | null; openTask: FollowUpTaskRef | null;
  }
  export interface PipelineView {
    columns: { key: BoardColumn; label: string; rows: Lead[] }[];
    counts: Record<BoardColumn, number>; total: number;
  }
  export interface CrmSettings {
    leadDesignation: string | null; effectiveDesignation: string | null;
    autoAssign: boolean; autoTask: boolean; taskDueHours: number; designations: string[];
  }
  export function fetchPipeline(interest?: LeadInterest): Promise<PipelineView>;
  export function setInterest(conversationId: string, interest: LeadInterest): Promise<{ ok: true }>;
  export function fetchTasks(scope?: "mine" | "all"): Promise<{ tasks: FollowUpTask[] }>;
  export function updateTask(id: string, patch: { status?: FollowUpStatus; dueAt?: string | null }): Promise<{ task: FollowUpTask }>;
  export function taskWhatsApp(id: string): Promise<{ url: string; text: string }>;
  export function fetchCrmSettings(): Promise<CrmSettings>;
  export function saveCrmSettings(patch: Partial<Pick<CrmSettings, "leadDesignation" | "autoAssign" | "autoTask" | "taskDueHours">>): Promise<CrmSettings>;
  // components
  export function CrmView(): JSX.Element;
  export function PipelineBoard(props: {
    columns: PipelineView["columns"]; canOverride: boolean; busyId: string | null;
    onOverride: (conversationId: string, interest: LeadInterest) => void;
  }): JSX.Element;
  export function TaskList(props: {
    tasks: FollowUpTask[]; onChanged: (task: FollowUpTask) => void;
  }): JSX.Element;
  export function RoutingSettings(props: {
    settings: CrmSettings; onSaved: (next: CrmSettings) => void;
  }): JSX.Element;
  ```

> **Note on tests:** `frontend/` has no unit-test runner. A screen task's gate is `npx tsc --noEmit`, `npx eslint . --max-warnings=0` and `npm run build`, all three run at the end of this task. Order the steps as written: every file is created before the commands run, so a missing export shows up as a named compile error rather than a blank screen.

- [ ] **Step 1: Write the API client**

Create `frontend/src/features/crm/api.ts`:

```ts
import { request } from "@/lib/api/http";

export { ApiError } from "@/lib/api/http";

/**
 * The CRM's own vocabulary.
 *
 * `Lead` repeats the shopfront and assignment fields the board draws instead
 * of extending the inbox's `Conversation`. The inbox may render a CRM surface
 * (Task 12 mounts the stage chip and the follow-up strip in the thread), but
 * the CRM never reaches back into the inbox: a type import is still a
 * dependency, and one direction is what keeps these two features apart.
 */
export type LeadInterest = "UNKNOWN" | "INTERESTED" | "NOT_INTERESTED";
export type FollowUpStatus = "OPEN" | "DONE" | "CANCELLED";
export type BoardColumn = "NEW" | "INTERESTED" | "FOLLOW_UP" | "NOT_INTERESTED";

/** The order the stage pickers offer, and the filter menu in Task 12. */
export const INTEREST_VALUES: readonly LeadInterest[] = [
  "UNKNOWN",
  "INTERESTED",
  "NOT_INTERESTED",
];

export const INTEREST_LABELS: Record<LeadInterest, string> = {
  UNKNOWN: "New",
  INTERESTED: "Interested",
  NOT_INTERESTED: "Not interested",
};

/** The follow-up a conversation carries, as the inbox also embeds it. */
export interface FollowUpTaskRef {
  id: string;
  title: string;
  dueAt: string | null;
  status: FollowUpStatus;
}

export interface FollowUpTask extends FollowUpTaskRef {
  note: string | null;
  completedAt: string | null;
  /** True once the deadline has passed and the task is still open. */
  overdue: boolean;
  conversationId: string;
  contact: { id: string; name: string | null; waId: string } | null;
  assignedTo: { id: string; name: string | null } | null;
}

/** One conversation on the board. */
export interface Lead {
  id: string;
  status: "OPEN" | "PENDING" | "CLOSED";
  contact: { id: string; waId: string; name: string | null };
  assignedTo: { id: string; name: string | null } | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unreadCount: number;
  interest: LeadInterest;
  /** The deciding message's evidence, so a manual stage shows none. */
  interestScore: number | null;
  interestReason: string | null;
  interestAt: string | null;
  openTask: FollowUpTaskRef | null;
}

export interface PipelineView {
  columns: { key: BoardColumn; label: string; rows: Lead[] }[];
  counts: Record<BoardColumn, number>;
  total: number;
}

export interface CrmSettings {
  /** What the owner stored; null means "not chosen". */
  leadDesignation: string | null;
  /** What rotation actually uses, including the single-designation fallback. */
  effectiveDesignation: string | null;
  autoAssign: boolean;
  autoTask: boolean;
  taskDueHours: number;
  designations: string[];
}

/**
 * The board. `interest` mirrors the route's own filter; the board itself draws
 * every column, so it never passes one.
 */
export function fetchPipeline(interest?: LeadInterest): Promise<PipelineView> {
  const suffix = interest ? `?interest=${interest}` : "";

  return request<PipelineView>(`/v1/crm/pipeline${suffix}`, { method: "GET" });
}

export function setInterest(
  conversationId: string,
  interest: LeadInterest,
): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    `/v1/crm/conversations/${encodeURIComponent(conversationId)}/interest`,
    { method: "PUT", body: JSON.stringify({ interest }) },
  );
}

export function fetchTasks(
  scope: "mine" | "all" = "mine",
): Promise<{ tasks: FollowUpTask[] }> {
  return request<{ tasks: FollowUpTask[] }>(`/v1/crm/tasks?scope=${scope}`, {
    method: "GET",
  });
}

export function updateTask(
  id: string,
  patch: { status?: FollowUpStatus; dueAt?: string | null },
): Promise<{ task: FollowUpTask }> {
  return request<{ task: FollowUpTask }>(
    `/v1/crm/tasks/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
}

/** The member's own WhatsApp link. 409 `NO_PERSONAL_NUMBER` when unset. */
export function taskWhatsApp(id: string): Promise<{ url: string; text: string }> {
  return request<{ url: string; text: string }>(
    `/v1/crm/tasks/${encodeURIComponent(id)}/wa-link`,
    { method: "POST" },
  );
}

export function fetchCrmSettings(): Promise<CrmSettings> {
  return request<CrmSettings>("/v1/crm/settings", { method: "GET" });
}

export function saveCrmSettings(
  patch: Partial<
    Pick<CrmSettings, "leadDesignation" | "autoAssign" | "autoTask" | "taskDueHours">
  >,
): Promise<CrmSettings> {
  return request<CrmSettings>("/v1/crm/settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}
```

- [ ] **Step 2: Write the board**

Create `frontend/src/features/crm/components/pipeline-board.tsx`:

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";

import {
  INTEREST_LABELS,
  INTEREST_VALUES,
  type LeadInterest,
  type PipelineView,
} from "../api";

const SELECT =
  "h-7 max-w-[9.5rem] rounded-md border border-input bg-background px-1.5 text-[11px] font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The pipeline as four columns, not a table: a stage is a place a conversation
 * sits in, and a lead that moves should be seen to move. The card's body is a
 * link into the thread — the board is a map, and the work happens in the inbox.
 */
export function PipelineBoard({
  columns,
  canOverride,
  busyId,
  onOverride,
}: {
  columns: PipelineView["columns"];
  canOverride: boolean;
  busyId: string | null;
  onOverride: (conversationId: string, interest: LeadInterest) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((column) => (
        <section
          key={column.key}
          aria-label={`${column.label} — ${column.rows.length}`}
          className="flex w-[17rem] shrink-0 flex-col rounded-xl border border-border bg-secondary/40"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h2 className="text-[12px] font-semibold text-foreground">
              {column.label}
            </h2>
            <span className="rounded-full bg-card px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground tabular-nums">
              {column.rows.length}
            </span>
          </header>

          <ul className="flex flex-col gap-2 p-2">
            {column.rows.length === 0 ? (
              <li className="px-1 py-6 text-center text-[11.5px] text-muted-foreground">
                Nothing here.
              </li>
            ) : null}

            {column.rows.map((lead) => {
              const name = lead.contact.name ?? `+${lead.contact.waId}`;

              return (
                <li
                  key={lead.id}
                  className="rounded-lg border border-border bg-card p-2.5"
                >
                  <Link
                    className="block min-w-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                    href={`/workspace/inbox?conversation=${encodeURIComponent(lead.id)}`}
                  >
                    <p className="flex items-baseline gap-1.5">
                      <span className="truncate text-[12.5px] font-medium text-foreground">
                        {name}
                      </span>
                      {lead.unreadCount > 0 ? (
                        <span className="ml-auto grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-foreground tabular-nums">
                          {lead.unreadCount > 99 ? "99+" : lead.unreadCount}
                        </span>
                      ) : null}
                    </p>

                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
                      {lead.lastMessagePreview ?? "No messages yet"}
                    </p>

                    <p className="mt-1 text-[10.5px] text-muted-foreground tabular-nums">
                      {dayLabel(lead.lastMessageAt)}
                      {lead.assignedTo
                        ? ` · ${lead.assignedTo.name ?? "assigned"}`
                        : " · unassigned"}
                    </p>
                  </Link>

                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-1.5">
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted-foreground">
                      {lead.interestReason ?? "No reason recorded"}
                    </span>

                    {canOverride ? (
                      <select
                        aria-label={`Stage for ${name}`}
                        className={SELECT}
                        disabled={busyId === lead.id}
                        onChange={(event) =>
                          onOverride(lead.id, event.target.value as LeadInterest)
                        }
                        value={lead.interest}
                      >
                        {INTEREST_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {INTEREST_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>

                  {lead.openTask ? (
                    <p className="mt-1.5 flex items-center gap-1 text-[10.5px] font-medium text-warning">
                      <CalendarClock aria-hidden="true" className="size-3" />
                      <span className="truncate">{lead.openTask.title}</span>
                      <span className="shrink-0 tabular-nums">
                        {dayLabel(lead.openTask.dueAt)}
                      </span>
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function dayLabel(iso: string | null): string {
  if (!iso) return "no date";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}
```

- [ ] **Step 3: Write the follow-up list**

Create `frontend/src/features/crm/components/task-list.tsx`:

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, Check, Loader2, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { ApiError, taskWhatsApp, updateTask, type FollowUpTask } from "../api";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The follow-ups someone owes, soonest first. Three actions, because those are
 * the three things a person does with a reminder: send it, finish it, or push
 * it a day.
 */
export function TaskList({
  tasks,
  onChanged,
}: {
  tasks: FollowUpTask[];
  onChanged: (task: FollowUpTask) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  function failed(title: string, caught: unknown) {
    toast({
      tone: "error",
      title,
      description:
        caught instanceof ApiError ? caught.message : "The request failed.",
      duration: 0,
    });
  }

  async function done(task: FollowUpTask) {
    setBusy(task.id);

    try {
      const { task: next } = await updateTask(task.id, { status: "DONE" });
      onChanged(next);
      toast({
        tone: "success",
        title: "Follow-up closed",
        description: next.title,
      });
    } catch (caught) {
      failed("Could not close the follow-up", caught);
    } finally {
      setBusy(null);
    }
  }

  async function tomorrow(task: FollowUpTask) {
    setBusy(task.id);

    try {
      const dueAt = new Date(Date.now() + DAY_MS).toISOString();
      const { task: next } = await updateTask(task.id, { dueAt });
      onChanged(next);
      toast({ tone: "success", title: "Pushed to tomorrow", description: next.title });
    } catch (caught) {
      failed("Could not move the deadline", caught);
    } finally {
      setBusy(null);
    }
  }

  async function send(task: FollowUpTask) {
    setBusy(task.id);

    try {
      const { url, text } = await taskWhatsApp(task.id);

      // The text names the business, the customer and the enquiry, so the
      // member is not writing a cold message. Copied as well as opened: a
      // browser that blocks the popup still leaves them something to paste.
      await navigator.clipboard.writeText(text).catch(() => undefined);
      window.open(url, "_blank", "noopener,noreferrer");

      toast({
        tone: "success",
        title: "Message copied",
        description: "Paste it into the chat and send.",
      });
    } catch (caught) {
      // 409 `NO_PERSONAL_NUMBER` lands here: the owner has not set this
      // member's number yet, and the message says which screen fixes it.
      failed("Could not open WhatsApp", caught);
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="space-y-2">
      {tasks.map((task) => (
        <li
          key={task.id}
          className={cn(
            "rounded-xl border bg-card p-3",
            task.overdue ? "border-destructive/40" : "border-border",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-foreground">{task.title}</p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {task.contact
                  ? task.contact.name ?? `+${task.contact.waId}`
                  : "The contact is gone"}
                {" · "}
                <Link
                  className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                  href={`/workspace/inbox?conversation=${encodeURIComponent(task.conversationId)}`}
                >
                  Open the chat
                </Link>
              </p>
            </div>

            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums",
                task.overdue
                  ? "bg-destructive/10 text-destructive"
                  : "bg-secondary text-muted-foreground",
              )}
            >
              {task.overdue ? "Overdue · " : "Due "}
              {dueLabel(task.dueAt)}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              disabled={busy === task.id}
              onClick={() => void send(task)}
              size="sm"
              type="button"
              variant="outline"
            >
              <MessageCircle aria-hidden="true" />
              Send from my WhatsApp
            </Button>

            <Button
              disabled={busy === task.id}
              onClick={() => void done(task)}
              size="sm"
              type="button"
            >
              {busy === task.id ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Check aria-hidden="true" />
              )}
              Done
            </Button>

            <Button
              disabled={busy === task.id}
              onClick={() => void tomorrow(task)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <CalendarClock aria-hidden="true" />
              Tomorrow
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function dueLabel(iso: string | null): string {
  if (!iso) return "no date";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}
```

- [ ] **Step 4: Write the routing card**

Create `frontend/src/features/crm/components/routing-settings.tsx`:

```tsx
"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";

import { ApiError, saveCrmSettings, type CrmSettings } from "../api";

const FIELD =
  "mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-[13.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";

/**
 * Who gets a new lead, and what they owe when they do.
 *
 * The designation is set per person on the Team screen; this card only chooses
 * which designation receives a lead. With exactly one designation on the
 * roster the choice is forced, and the line under the picker says so — a
 * control whose value the server overrides has to explain itself.
 */
export function RoutingSettings({
  settings,
  onSaved,
}: {
  settings: CrmSettings;
  onSaved: (next: CrmSettings) => void;
}) {
  const toast = useToast();
  const [designation, setDesignation] = React.useState(settings.leadDesignation ?? "");
  const [autoAssign, setAutoAssign] = React.useState(settings.autoAssign);
  const [autoTask, setAutoTask] = React.useState(settings.autoTask);
  const [dueHours, setDueHours] = React.useState(String(settings.taskDueHours));
  const [busy, setBusy] = React.useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const hours = Number(dueHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
      toast({
        tone: "error",
        title: "Due hours must be a whole number from 1 to 720",
        duration: 0,
      });
      return;
    }

    setBusy(true);

    try {
      const next = await saveCrmSettings({
        leadDesignation: designation || null,
        autoAssign,
        autoTask,
        taskDueHours: hours,
      });

      onSaved(next);
      setDesignation(next.leadDesignation ?? "");
      toast({ tone: "success", title: "Lead routing saved" });
    } catch (caught) {
      toast({
        tone: "error",
        title: "Could not save the routing",
        description:
          caught instanceof ApiError ? caught.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setBusy(false);
    }
  }

  const noRoster = settings.designations.length === 0;

  return (
    <form
      className="max-w-xl space-y-4 rounded-xl border border-border bg-card p-4"
      onSubmit={(event) => void save(event)}
    >
      <div>
        <Label htmlFor="lead-designation">New leads go to</Label>
        <select
          className={FIELD}
          disabled={noRoster || busy}
          id="lead-designation"
          onChange={(event) => setDesignation(event.target.value)}
          value={designation}
        >
          <option value="">Choose a designation</option>
          {settings.designations.map((row) => (
            <option key={row} value={row}>
              {row}
            </option>
          ))}
        </select>

        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
          {noRoster
            ? "Nobody on the roster has a designation yet. Set one for each person on Team & permissions, then come back."
            : settings.effectiveDesignation
              ? `Leads currently rotate to: ${settings.effectiveDesignation}.`
              : "Nothing rotates until a designation is chosen and someone on the roster carries it."}
        </p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="auto-assign">Assign the conversation</Label>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            The lead is handed to the next person in rotation, so it appears in
            their inbox the moment it becomes interested.
          </p>
        </div>
        <Switch
          checked={autoAssign}
          disabled={busy}
          id="auto-assign"
          onCheckedChange={setAutoAssign}
        />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="auto-task">Open a follow-up task</Label>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Every interested lead gets a task with a deadline, so nobody has to
            remember it.
          </p>
        </div>
        <Switch
          checked={autoTask}
          disabled={busy}
          id="auto-task"
          onCheckedChange={setAutoTask}
        />
      </div>

      <div>
        <Label htmlFor="due-hours">Close the follow-up within</Label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            className="h-9 w-24 rounded-lg border border-input bg-background px-3 text-[13.5px] text-foreground tabular-nums shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]"
            disabled={busy}
            id="due-hours"
            inputMode="numeric"
            max={720}
            min={1}
            onChange={(event) => setDueHours(event.target.value)}
            type="number"
            value={dueHours}
          />
          <span className="text-[12.5px] text-muted-foreground">hours</span>
        </div>
      </div>

      <Button disabled={busy} size="sm" type="submit">
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Save routing
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: Write the screen**

Create `frontend/src/features/crm/components/crm-view.tsx`:

```tsx
"use client";

import * as React from "react";
import { CalendarClock, Inbox } from "lucide-react";

import { useAccess } from "@/components/workspace/access-provider";
import { EmptyState } from "@/components/workspace/empty-state";
import { cn } from "@/lib/utils";

import {
  ApiError,
  fetchCrmSettings,
  fetchPipeline,
  fetchTasks,
  setInterest,
  type CrmSettings,
  type FollowUpTask,
  type PipelineView,
  type LeadInterest,
} from "../api";
import { PipelineBoard } from "./pipeline-board";
import { RoutingSettings } from "./routing-settings";
import { TaskList } from "./task-list";

type Tab = "pipeline" | "tasks" | "routing";

const TABS: { key: Tab; label: string }[] = [
  { key: "pipeline", label: "Pipeline" },
  { key: "tasks", label: "My follow-ups" },
  { key: "routing", label: "Routing" },
];

/**
 * Three views of the same leads: where they are, what the viewer owes them,
 * and — for the owner — who receives them. The routing tab is the only one
 * behind ownership, because it changes what happens to everybody's work.
 */
export function CrmView() {
  const { role } = useAccess();
  const owner = role === "OWNER";
  const canOverride = owner || role === "ADMIN" || role === "MANAGER";

  const [tab, setTab] = React.useState<Tab>("pipeline");
  const [pipeline, setPipeline] = React.useState<PipelineView | null>(null);
  const [tasks, setTasks] = React.useState<FollowUpTask[] | null>(null);
  const [settings, setSettings] = React.useState<CrmSettings | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;

    Promise.all([fetchPipeline(), fetchTasks("mine")])
      .then(([board, list]) => {
        if (!active) return;
        setPipeline(board);
        setTasks(list.tasks);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (active) setError(readError(caught));
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  // The routing card is an owner's read; asking for it as a member would be a
  // 403 the screen never shows anything for.
  React.useEffect(() => {
    if (!owner) return;

    let active = true;

    fetchCrmSettings()
      .then((next) => {
        if (active) setSettings(next);
      })
      .catch((caught: unknown) => {
        if (active) setError(readError(caught));
      });

    return () => {
      active = false;
    };
  }, [owner, attempt]);

  async function override(conversationId: string, interest: LeadInterest) {
    setBusyId(conversationId);

    try {
      await setInterest(conversationId, interest);
      // Re-read rather than patch the row: a manual "not interested" also
      // cancels the open task, and the board has to show the task it freed.
      setPipeline(await fetchPipeline());
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setBusyId(null);
    }
  }

  function taskChanged(next: FollowUpTask) {
    setTasks((current) =>
      current
        ? current.map((row) => (row.id === next.id ? next : row))
        : current,
    );
  }

  const visible = TABS.filter((row) => owner || row.key !== "routing");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 self-start rounded-lg border border-border bg-card p-1">
        {visible.map((row) => (
          <button
            key={row.key}
            aria-current={tab === row.key ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              tab === row.key
                ? "bg-brand-soft text-brand"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            onClick={() => setTab(row.key)}
            type="button"
          >
            {row.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-[12px] leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}

      {tab === "pipeline" ? (
        pipeline ? (
          pipeline.total === 0 ? (
            <EmptyState
              description="A conversation lands here as soon as a customer writes in."
              icon={Inbox}
              title="No leads yet"
            />
          ) : (
            <PipelineBoard
              busyId={busyId}
              canOverride={canOverride}
              columns={pipeline.columns}
              onOverride={(id, next) => void override(id, next)}
            />
          )
        ) : (
          <Skeleton />
        )
      ) : null}

      {tab === "tasks" ? (
        tasks ? (
          tasks.length === 0 ? (
            <EmptyState
              description="Every interested lead opens one. Nothing is waiting on you."
              icon={CalendarClock}
              title="No follow-ups"
            />
          ) : (
            <TaskList onChanged={taskChanged} tasks={tasks} />
          )
        ) : (
          <Skeleton />
        )
      ) : null}

      {tab === "routing" ? (
        settings ? (
          <RoutingSettings onSaved={setSettings} settings={settings} />
        ) : (
          <Skeleton />
        )
      ) : null}
    </div>
  );
}

function Skeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-56 animate-pulse rounded-xl border border-border bg-card"
    />
  );
}

function readError(caught: unknown): string {
  return caught instanceof ApiError
    ? caught.message
    : "The leads could not be read.";
}
```

- [ ] **Step 6: Write the page**

Create `frontend/src/app/(app)/workspace/crm/page.tsx`:

```tsx
import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/workspace/page-header";
import { CrmView } from "@/features/crm/components/crm-view";
import { getNavItem } from "@/config/workspace-nav";
import { getSessionUser } from "@/lib/auth/session";

const nav = getNavItem("/workspace/crm");

export const metadata: Metadata = { title: nav.title };

/**
 * The leads are read by the client, because the request needs the browser's
 * session token; the page only has to know that someone is signed in.
 */
async function Leads() {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/workspace/crm")}`);

  return <CrmView />;
}

function LeadsSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-56 animate-pulse rounded-xl border border-border bg-card"
    />
  );
}

export default function LeadsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="The conversations that showed interest, the follow-ups they owe and who receives the next one. The inbox is where you answer; this is where you decide who does."
        eyebrow={nav.group}
        title={nav.title}
      />

      <Suspense fallback={<LeadsSkeleton />}>
        <Leads />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 7: Register the nav item**

In `frontend/src/config/workspace-nav.ts`, add `Target` to the lucide import, between `Sparkles` and `Users`:

```ts
  Sparkles,
  Target,
  Users,
```

and add the item to the Operations group, after the Contacts entry and before QR codes:

```ts
      {
        title: "Leads",
        href: "/workspace/crm",
        description: "Interested chats, follow-up tasks and who receives new leads",
        icon: Target,
        module: "crm",
      },
```

The `module` field is what gates the route: `moduleForPath` refuses `/workspace/crm` to a role without `crm`, so the page and its nav entry cannot disagree.

- [ ] **Step 8: Gates**

Run: `cd frontend; npx tsc --noEmit; npx eslint . --max-warnings=0; npm run build`
Expected: no type errors, no lint warnings, and the build prints the `/workspace/crm` route.

- [ ] **Step 9: Checkpoint**

Run: `cd frontend; git status --short`
Expected: seven files — six created, `workspace-nav.ts` modified. Do not commit.

---

### Task 11: Giving a person a designation and a number

**Files:**
- Modify: `frontend/src/features/team/api.ts`
- Create: `frontend/src/features/team/components/member-profile-sheet.tsx`
- Modify: `frontend/src/features/team/components/team-view.tsx`
- Modify: `frontend/src/app/(app)/workspace/team/page.tsx`

**Interfaces:**
- Consumes: `PATCH /v1/workspaces/members/:userId/profile` with `{ fullName?: string; designation?: string | null; personalWhatsApp?: string | null }` → `{ member: Member }` (Task 4). `Member` already carries `designation` and `personalWhatsApp` on the wire; the frontend type is what is missing.
- Produces:
  ```ts
  // features/team/api.ts
  export function updateMemberProfile(
    userId: string,
    input: { fullName?: string; designation?: string | null; personalWhatsApp?: string | null },
  ): Promise<{ member: Member }>;
  // components/member-profile-sheet.tsx
  export function MemberProfileSheet(props: {
    member: Member;
    /** Designations already in use, offered as a datalist. */
    designations: string[];
    onClose: () => void;
    onSaved: (member: Member) => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Extend the member type and add the write**

In `frontend/src/features/team/api.ts`, add the two fields to `Member`, after `owner`:

```ts
  /** The workspace owner: role immutable, membership irremovable. */
  owner: boolean;
  /**
   * The label lead rotation sorts by. Null means the owner has not set one,
   * and a person without one is never handed a lead.
   */
  designation: string | null;
  /** Digits only, country code first; null when unset. */
  personalWhatsApp: string | null;
```

and add the call after `changeMemberRole`:

```ts
/**
 * The parts of a person's profile the owner controls. Email is not among them:
 * it is the identity they sign in with, and changing it is a verified flow of
 * its own.
 */
export function updateMemberProfile(
  userId: string,
  input: {
    fullName?: string;
    designation?: string | null;
    personalWhatsApp?: string | null;
  },
): Promise<{ member: Member }> {
  return request<{ member: Member }>(
    `/v1/workspaces/members/${encodeURIComponent(userId)}/profile`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}
```

- [ ] **Step 2: Write the sheet**

Create `frontend/src/features/team/components/member-profile-sheet.tsx`:

```tsx
"use client";

import * as React from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";

import { ApiError, updateMemberProfile, type Member } from "../api";

const FIELD =
  "mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-[13.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";

/**
 * The three things an owner sets about a person that are not their role: the
 * name colleagues see, the designation lead rotation sorts by, and the number
 * the "Send from my WhatsApp" link opens.
 *
 * Email is deliberately absent — it is the Supabase identity, and changing it
 * is a verified flow of its own, not a field on this form.
 */
export function MemberProfileSheet({
  member,
  designations,
  onClose,
  onSaved,
}: {
  member: Member;
  designations: string[];
  onClose: () => void;
  onSaved: (member: Member) => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState(member.name ?? "");
  const [designation, setDesignation] = React.useState(member.designation ?? "");
  const [personal, setPersonal] = React.useState(member.personalWhatsApp ?? "");
  const [busy, setBusy] = React.useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // The field accepts spaces and dashes a person types out of habit; the
    // number that leaves is digits only, because that is what `wa.me` takes.
    const digits = personal.replace(/\D+/g, "");

    if (digits && (digits.length < 8 || digits.length > 15)) {
      toast({
        tone: "error",
        title: "The number needs 8 to 15 digits, country code first",
        duration: 0,
      });
      return;
    }

    setBusy(true);

    try {
      const { member: next } = await updateMemberProfile(member.userId, {
        // Omitted rather than sent empty: an empty name would clear the one
        // the person signed up with.
        fullName: name.trim() || undefined,
        designation: designation.trim() || null,
        personalWhatsApp: digits || null,
      });

      onSaved(next);
      toast({
        tone: "success",
        title: "Profile saved",
        description: next.name ?? next.email,
      });
    } catch (caught) {
      toast({
        tone: "error",
        title: "Could not save the profile",
        description:
          caught instanceof ApiError ? caught.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{member.name ?? member.email}</SheetTitle>
          <SheetDescription>
            These details stay inside the workspace. The number is only ever
            used to open a chat in that member&apos;s own WhatsApp.
          </SheetDescription>
        </SheetHeader>

        <form
          className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4"
          onSubmit={(event) => void save(event)}
        >
          <div>
            <Label htmlFor="profile-name">Name</Label>
            <input
              className={FIELD}
              id="profile-name"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="The name colleagues see"
              type="text"
              value={name}
            />
          </div>

          <div>
            <Label htmlFor="profile-designation">Designation</Label>
            <input
              className={FIELD}
              id="profile-designation"
              list="profile-designations"
              maxLength={40}
              onChange={(event) => setDesignation(event.target.value)}
              placeholder="Sales, Support, Dispatch"
              type="text"
              value={designation}
            />
            <datalist id="profile-designations">
              {designations.map((row) => (
                <option key={row} value={row} />
              ))}
            </datalist>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              Lead rotation sorts by this exact label, so reuse one that already
              exists. Two spellings are two pools that never merge.
            </p>
          </div>

          <div>
            <Label htmlFor="profile-whatsapp">Personal WhatsApp</Label>
            <input
              className={FIELD}
              id="profile-whatsapp"
              inputMode="numeric"
              maxLength={15}
              onChange={(event) => setPersonal(event.target.value)}
              placeholder="919876543210"
              type="text"
              value={personal}
            />
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              Digits only, with the country code. Nothing is sent from here by
              itself — the follow-up link opens the chat and the member sends.
            </p>
          </div>

          <div className="mt-auto flex gap-2 pt-2">
            <Button disabled={busy} size="sm" type="submit">
              {busy ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : null}
              Save profile
            </Button>
            <Button
              disabled={busy}
              onClick={onClose}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 3: Add the column, the row action and the roster labels**

In `frontend/src/features/team/components/team-view.tsx`:

**a.** Add `Pencil` to the lucide import, between `LoaderCircle` and `Trash2`:

```ts
  LoaderCircle,
  Pencil,
  Trash2,
```

and import the sheet beside `PermissionsCard`:

```ts
import { PermissionsCard } from "./permissions-card";
import { MemberProfileSheet } from "./member-profile-sheet";
```

**b.** Add the column between role and access:

```ts
const MEMBER_COLUMNS = [
  { key: "member", label: "Member" },
  { key: "role", label: "Role" },
  { key: "designation", label: "Designation" },
  { key: "access", label: "Access", className: "text-right" },
];
```

**c.** In `TeamView`, after the `tab` state and before the loading return — a hook cannot live below that return, which is why the comment there exists — add the roster's labels:

```tsx
  /**
   * Every designation already in use, for the sheet's datalist. Offering them
   * is what stops "sales" and "Sales" becoming two pools.
   */
  const designations = React.useMemo(
    () => [
      ...new Set(
        (workspace?.members ?? [])
          .map((member) => member.designation)
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort(),
    [workspace],
  );
```

Pass it down at the `<MembersTable` call site:

```tsx
          <MembersTable
            canManage={canManage}
            designations={designations}
            members={workspace.members}
            onMemberChanged={replaceMember}
            onMemberRemoved={dropMember}
            onToast={toast.push}
            viewerId={viewerId}
          />
```

**d.** In `MembersTable`, accept the prop and hold the open sheet:

```tsx
function MembersTable({
  canManage,
  designations,
  members,
  viewerId,
  onMemberChanged,
  onMemberRemoved,
  onToast,
}: {
  canManage: boolean;
  designations: string[];
  members: Member[];
  viewerId: string;
  onMemberChanged: (member: Member) => void;
  onMemberRemoved: (userId: string) => void;
  onToast: (options: ToastOptions) => void;
}) {
  const [armed, setArmed] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  /** The row whose profile sheet is open; null when none is. */
  const [editing, setEditing] = React.useState<Member | null>(null);
```

**e.** In the member cell, after the "You" chip, add the edit button. The owner's own row has none: rotation excludes the owner, so a designation there would be a field nothing reads.

```tsx
        {canManage && !member.owner ? (
          <button
            aria-label={`Edit the profile for ${member.name ?? member.email}`}
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setEditing(member)}
            type="button"
          >
            <Pencil aria-hidden="true" className="size-3" />
          </button>
        ) : null}
```

**f.** Add the designation cell between the role cell and the access cell in `rows`:

```tsx
    <span className="truncate text-[12.5px] text-muted-foreground" key="designation">
      {member.designation ?? "—"}
    </span>,
```

**g.** Render the sheet after the table, inside the `<section>`:

```tsx
        rows={rows}
      />

      {editing ? (
        <MemberProfileSheet
          designations={designations}
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={(member) => {
            onMemberChanged(member);
            setEditing(null);
          }}
        />
      ) : null}
    </section>
```

- [ ] **Step 4: Say what the page is now for**

In `frontend/src/app/(app)/workspace/team/page.tsx`, extend the header description — the new column and sheet are otherwise undiscoverable:

```tsx
      <PageHeader
        description="Roles decide who sends campaigns, who answers the inbox and who manages the workspace. Only the owner invites people and changes roles — and with no mailer in this deployment, an invitation is a link you pass on yourself. Each person also gets a designation and their own WhatsApp number, so interested leads rotate to the right desk and follow-ups go out from the right phone."
        eyebrow={nav.group}
        title={nav.title}
      />
```

- [ ] **Step 5: Gates**

Run: `cd frontend; npx tsc --noEmit; npx eslint . --max-warnings=0; npm run build`
Expected: no type errors, no lint warnings, a clean build.

- [ ] **Step 6: Checkpoint**

Run: `cd frontend; git status --short`
Expected: four files — `member-profile-sheet.tsx` created; `team/api.ts`, `team-view.tsx` and `team/page.tsx` modified. Do not commit.

---

### Task 12: The stage in the inbox, and the follow-ups on the overview

**Files:**
- Modify: `frontend/src/features/inbox/api.ts`
- Modify: `frontend/src/features/inbox/components/conversation-list.tsx`
- Create: `frontend/src/features/crm/components/interest-chip.tsx`
- Create: `frontend/src/features/crm/components/follow-up-strip.tsx`
- Create: `frontend/src/features/crm/components/follow-ups-card.tsx`
- Modify: `frontend/src/features/inbox/components/message-thread.tsx`
- Modify: `frontend/src/app/(app)/workspace/page.tsx`

**Interfaces:**
- Consumes: the fields Task 9 added to `ConversationView` — `interest`, `interestScore`, `interestReason`, `interestAt`, `openTask` — and `?interest=` on `GET /v1/inbox/conversations`; `setInterest`, `updateTask`, `taskWhatsApp`, `INTEREST_LABELS`, `INTEREST_VALUES`, `ApiError`, types `LeadInterest`, `FollowUpTaskRef`, `FollowUpTask` (Task 10); `MessageThread`'s `onChanged: (conversation: Conversation) => void` and its `isAgent` local.
- Produces:
  ```ts
  // features/inbox/api.ts — additions
  export interface Conversation {
    // …existing fields, plus:
    interest: LeadInterest;
    interestScore: number | null;
    interestReason: string | null;
    interestAt: string | null;
    openTask: FollowUpTaskRef | null;
  }
  export interface ConversationFilters {
    // …existing fields, plus:
    interest?: LeadInterest;
  }
  // components
  export function InterestChip(props: {
    conversationId: string; interest: LeadInterest; interestReason: string | null;
    canOverride: boolean;
    onChanged: (patch: { interest: LeadInterest; interestReason: string; interestAt: string }) => void;
  }): JSX.Element;
  export function FollowUpStrip(props: {
    task: FollowUpTaskRef | null;
    onChanged: (task: FollowUpTask | null) => void;
  }): JSX.Element | null;
  export function FollowUpsCard(): JSX.Element | null;
  ```

**Dependency direction:** this task's new components live under `features/crm/` and the inbox imports them, never the reverse. That is the one direction allowed between these two features; `features/crm/api.ts` still imports nothing from `features/inbox/`.

- [ ] **Step 1: Teach the inbox what a lead is**

In `frontend/src/features/inbox/api.ts`, add the type import above the existing two:

```ts
import type { FollowUpTaskRef, LeadInterest } from "@/features/crm/api";
import { request, upload } from "@/lib/api/http";
import type { BotCard, BotFlow, BotView } from "@/lib/bots/card";
```

Add the five fields to `Conversation`, after `aiPauseReason`:

```ts
  /** Why, in one word — `human`, `manual`, `handoff`, `no-context`,
      `unavailable`. A tooltip. */
  aiPauseReason: string | null;
  /** Where the classifier put this lead. `manual` in the reason means a person did. */
  interest: LeadInterest;
  /** The deciding message's evidence; null once a person set the stage. */
  interestScore: number | null;
  interestReason: string | null;
  interestAt: string | null;
  /** The open follow-up, so the thread can offer it without a second read. */
  openTask: FollowUpTaskRef | null;
```

Add the filter:

```ts
export interface ConversationFilters {
  search?: string;
  status?: ConversationStatus;
  /** A user id, `me`, or `unassigned`. */
  assignee?: string;
  /** A stage, so the queue can be read one column of the board at a time. */
  interest?: LeadInterest;
}
```

and serialize it in `fetchConversations`, after the `assignee` line:

```ts
  if (filters.assignee) query.set("assignee", filters.assignee);
  if (filters.interest) query.set("interest", filters.interest);
```

- [ ] **Step 2: Add the stage to the queue's filter menu and its rows**

In `frontend/src/features/inbox/components/conversation-list.tsx`:

**a.** Import the CRM's stage vocabulary beside the inbox types:

```ts
import {
  INTEREST_LABELS,
  INTEREST_VALUES,
  type LeadInterest,
} from "@/features/crm/api";

import {
  type Conversation,
  type ConversationFilters,
  type ConversationStatus,
} from "../api";
```

**b.** Add the option list after `ASSIGNEES`:

```ts
const INTERESTS: { value: LeadInterest | ""; label: string }[] = [
  { value: "", label: "Any stage" },
  ...INTEREST_VALUES.map((value) => ({
    value,
    label: INTEREST_LABELS[value],
  })),
];
```

**c.** Replace the two label lookups and the summary so a filter reads as what it is:

```tsx
  const statusLabel =
    STATUSES.find((row) => row.value === (filters.status ?? ""))?.label ?? "All statuses";
  const assigneeLabel =
    ASSIGNEES.find((row) => row.value === (filters.assignee ?? ""))?.label ?? "Anyone";
  const interestLabel =
    INTERESTS.find((row) => row.value === (filters.interest ?? ""))?.label ?? "Any stage";
```

```tsx
  // Only the filters that are doing something, so the pill says "Interested"
  // rather than "All statuses · Anyone · Interested".
  const active = [
    filters.status ? statusLabel : null,
    filters.assignee ? assigneeLabel : null,
    filters.interest ? interestLabel : null,
  ].filter((value): value is string => Boolean(value));

  const filtered = active.length > 0;
  const summary = filtered ? active.join(" · ") : "All chats";
```

**d.** Add the section to the menu, after the `ASSIGNEES` block and before the Clear filters block:

```tsx
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Stage</DropdownMenuLabel>
              {INTERESTS.map((row) => (
                <DropdownMenuItem
                  key={row.label}
                  onSelect={() =>
                    onFiltersChange({
                      ...filters,
                      interest: row.value || undefined,
                    })
                  }
                >
                  {row.label}
                  {!filters.interest && row.value === "" ? <Check className="ml-auto" /> : null}
                  {filters.interest === row.value ? <Check className="ml-auto" /> : null}
                </DropdownMenuItem>
              ))}
```

**e.** Extend the empty-state condition:

```tsx
            {filters.search || filters.status || filters.assignee || filters.interest
              ? "No conversation matches these filters."
              : "No conversations yet. A customer's first message opens one."}
```

**f.** In the row, between the preview span and the unread badge, add the stage chip:

```tsx
                            {conversation.interest !== "UNKNOWN" ? (
                              <span
                                className={cn(
                                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                  conversation.interest === "INTERESTED"
                                    ? "bg-brand-soft text-brand"
                                    : "bg-secondary text-muted-foreground",
                                )}
                              >
                                {INTEREST_LABELS[conversation.interest]}
                              </span>
                            ) : null}
```

- [ ] **Step 3: Write the stage strip**

Create `frontend/src/features/crm/components/interest-chip.tsx`:

```tsx
"use client";

import * as React from "react";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  ApiError,
  INTEREST_LABELS,
  INTEREST_VALUES,
  setInterest,
  type LeadInterest,
} from "../api";

/**
 * The stage of the conversation on screen, and the one place a person can
 * correct it.
 *
 * The classifier's reason is shown beside the stage: a verdict nobody typed is
 * only trustworthy when the evidence is visible. A manual change says so in
 * the reason, so the next reader can tell the machine's opinion from a
 * colleague's.
 */
export function InterestChip({
  conversationId,
  interest,
  interestReason,
  canOverride,
  onChanged,
}: {
  conversationId: string;
  interest: LeadInterest;
  interestReason: string | null;
  /** A manager and above. An agent sees the stage and changes nothing. */
  canOverride: boolean;
  onChanged: (patch: {
    interest: LeadInterest;
    interestReason: string;
    interestAt: string;
  }) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  async function override(next: LeadInterest) {
    if (next === interest) return;

    setBusy(true);

    try {
      await setInterest(conversationId, next);

      onChanged({
        interest: next,
        interestReason: "manual",
        interestAt: new Date().toISOString(),
      });
    } catch (caught) {
      toast({
        tone: "error",
        title: "Could not change the stage",
        description:
          caught instanceof ApiError ? caught.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setBusy(false);
    }
  }

  const tone =
    interest === "INTERESTED"
      ? "bg-brand-soft text-brand"
      : interest === "NOT_INTERESTED"
        ? "bg-destructive/10 text-destructive"
        : "bg-secondary text-muted-foreground";

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-secondary/40 px-3 py-1.5 text-[11px] sm:px-4">
      <span className="font-medium text-muted-foreground">Stage</span>

      {canOverride ? (
        <select
          aria-label="Stage of this conversation"
          className={cn(
            "h-6 rounded-full px-2 text-[11px] font-semibold outline-none",
            "focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60",
            tone,
          )}
          disabled={busy}
          onChange={(event) => void override(event.target.value as LeadInterest)}
          value={interest}
        >
          {INTEREST_VALUES.map((value) => (
            <option key={value} value={value}>
              {INTEREST_LABELS[value]}
            </option>
          ))}
        </select>
      ) : (
        <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", tone)}>
          {INTEREST_LABELS[interest]}
        </span>
      )}

      {interestReason ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {interestReason === "manual" ? "set by hand" : interestReason}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          No signal yet
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the follow-up strip**

Create `frontend/src/features/crm/components/follow-up-strip.tsx`:

```tsx
"use client";

import * as React from "react";
import { CalendarClock, Check, Loader2, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  ApiError,
  taskWhatsApp,
  updateTask,
  type FollowUpTask,
  type FollowUpTaskRef,
} from "../api";

/**
 * The open follow-up under the thread's header. Nothing renders when nothing
 * is owed: a strip that says "no task" on every ordinary conversation is a
 * band of height for a sentence nobody needs.
 */
export function FollowUpStrip({
  task,
  onChanged,
}: {
  task: FollowUpTaskRef | null;
  onChanged: (task: FollowUpTask | null) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  if (!task) return null;

  const overdue = task.dueAt !== null && Date.parse(task.dueAt) < Date.now();

  function failed(title: string, caught: unknown) {
    toast({
      tone: "error",
      title,
      description:
        caught instanceof ApiError ? caught.message : "The request failed.",
      duration: 0,
    });
  }

  async function done() {
    setBusy(true);

    try {
      const { task: next } = await updateTask(task.id, { status: "DONE" });
      onChanged(next);
    } catch (caught) {
      failed("Could not close the follow-up", caught);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);

    try {
      const { url, text } = await taskWhatsApp(task.id);

      await navigator.clipboard.writeText(text).catch(() => undefined);
      window.open(url, "_blank", "noopener,noreferrer");

      toast({
        tone: "success",
        title: "Message copied",
        description: "Paste it into the chat and send.",
      });
    } catch (caught) {
      // 409 `NO_PERSONAL_NUMBER` lands here; the API's sentence says who sets it.
      failed("Could not open WhatsApp", caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 sm:px-4">
      <CalendarClock
        aria-hidden="true"
        className={cn("size-3.5", overdue ? "text-destructive" : "text-muted-foreground")}
      />

      <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">
        {task.title}
        <span
          className={cn(
            "ml-1.5 text-[10.5px] tabular-nums",
            overdue ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {overdue ? "overdue" : "due"} {dueLabel(task.dueAt)}
        </span>
      </span>

      <Button
        disabled={busy}
        onClick={() => void send()}
        size="sm"
        type="button"
        variant="outline"
      >
        <MessageCircle aria-hidden="true" />
        Send from my WhatsApp
      </Button>

      <Button disabled={busy} onClick={() => void done()} size="sm" type="button">
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        Done
      </Button>
    </div>
  );
}

function dueLabel(iso: string | null): string {
  if (!iso) return "no date";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}
```

Only the task's own id is needed: `updateTask` and `taskWhatsApp` both address the task, so the strip takes no conversation id at all.

- [ ] **Step 5: Mount both above the timeline**

In `frontend/src/features/inbox/components/message-thread.tsx`:

**a.** Add the two lines after the file's existing `useAccess` import:

```ts
import { FollowUpStrip } from "@/features/crm/components/follow-up-strip";
import { InterestChip } from "@/features/crm/components/interest-chip";
```

**b.** Next to `const isAgent = role === "AGENT";` add the stage permission:

```ts
  const isAgent = role === "AGENT";
  /** The stage is a manager's call; an agent reads it and moves on. */
  const canSetStage = role === "MANAGER" || role === "ADMIN" || role === "OWNER";
```

**c.** Immediately after `</header>` and before the scrolling canvas's comment, add:

```tsx
      <InterestChip
        canOverride={canSetStage}
        conversationId={conversation.id}
        interest={conversation.interest}
        interestReason={conversation.interestReason}
        onChanged={(patch) =>
          onChanged({
            ...conversation,
            ...patch,
            // A manual "not interested" cancels the open task server-side, so
            // the thread must not keep offering one that no longer exists.
            openTask:
              patch.interest === "NOT_INTERESTED" ? null : conversation.openTask,
          })
        }
      />

      <FollowUpStrip
        onChanged={(task) =>
          onChanged({
            ...conversation,
            openTask: task && task.status === "OPEN" ? task : null,
          })
        }
        task={conversation.openTask}
      />
```

The `conversation` local is already the thread's conversation (`const conversation = thread.conversation;`), so both components read the same row the header does.

- [ ] **Step 6: Put the agent's follow-ups on the overview**

Create `frontend/src/features/crm/components/follow-ups-card.tsx`:

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { useModule } from "@/components/workspace/access-provider";
import { cn } from "@/lib/utils";

import { fetchTasks, type FollowUpTask } from "../api";

const SHOWN = 5;

/**
 * The viewer's open follow-ups, on the screen every role lands on.
 *
 * An agent cannot open the Leads page — the module is a manager's — but every
 * agent can be handed a follow-up, so the one place they all land has to show
 * them. The card is silent for a role without the inbox, because there is
 * nothing behind it to read.
 */
export function FollowUpsCard() {
  const inbox = useModule("inbox");
  const [tasks, setTasks] = React.useState<FollowUpTask[] | null>(null);

  React.useEffect(() => {
    if (!inbox) return;

    let active = true;

    fetchTasks("mine")
      .then((payload) => {
        if (active) setTasks(payload.tasks);
      })
      .catch(() => {
        // A dashboard card that cannot read is a card that does not appear;
        // the Leads screen is where the error is explained.
        if (active) setTasks([]);
      });

    return () => {
      active = false;
    };
  }, [inbox]);

  if (!inbox) return null;

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-foreground">Your follow-ups</h2>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {tasks === null ? "reading…" : `${tasks.length} open`}
        </span>
      </header>

      {tasks === null ? (
        <div aria-hidden="true" className="space-y-2 p-4">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">
          Nothing owed. An interested lead opens one automatically.
        </p>
      ) : (
        <ul>
          {tasks.slice(0, SHOWN).map((task) => (
            <li key={task.id} className="border-b border-border last:border-0">
              <Link
                className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-secondary/50"
                href={`/workspace/inbox?conversation=${encodeURIComponent(task.conversationId)}`}
              >
                <CalendarClock
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 shrink-0",
                    task.overdue ? "text-destructive" : "text-muted-foreground",
                  )}
                />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-foreground">
                    {task.title}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {task.contact
                      ? task.contact.name ?? `+${task.contact.waId}`
                      : "The contact is gone"}
                  </span>
                </span>

                <span
                  className={cn(
                    "shrink-0 text-[10.5px] tabular-nums",
                    task.overdue ? "font-medium text-destructive" : "text-muted-foreground",
                  )}
                >
                  {dueLabel(task.dueAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function dueLabel(iso: string | null): string {
  if (!iso) return "no date";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}
```

- [ ] **Step 7: Mount the card on the overview**

In `frontend/src/app/(app)/workspace/page.tsx`, import it beside `DashboardBoard`:

```ts
import { DashboardBoard } from "@/components/workspace/dashboard/dashboard-board";
import { PageHeader } from "@/components/workspace/page-header";
import { FollowUpsCard } from "@/features/crm/components/follow-ups-card";
import { ConnectCta } from "@/features/whatsapp/components/connect-cta";
import { getSessionUser } from "@/lib/auth/session";
```

and render it after the board, inside the page's `space-y-6`:

```tsx
      <DashboardBoard />

      <FollowUpsCard />
```

- [ ] **Step 8: Gates**

Run: `cd frontend; npx tsc --noEmit; npx eslint . --max-warnings=0; npm run build`
Expected: no type errors, no lint warnings, a clean build.

- [ ] **Step 9: Checkpoint**

Run: `cd frontend; git status --short`
Expected: seven files — three created (`interest-chip.tsx`, `follow-up-strip.tsx`, `follow-ups-card.tsx`); `inbox/api.ts`, `conversation-list.tsx`, `message-thread.tsx` and `workspace/page.tsx` modified. Do not commit.

---

### Task 13: The whole suite, and the report

**Files:** none. This task runs everything the earlier tasks only ran piecemeal, then writes the hand-off note.

**Interfaces:**
- Consumes: every gate command the Global Constraints name.
- Produces: a report the owner reads before applying the migration.

- [ ] **Step 1: Run the backend suite**

Run: `cd Backend; npm test`
Expected: all suites pass, including the new `interest.rules`, `round.robin`, `tasks.service`, `crm.pipeline`, `team.dto` and the extended `modules` and `inbox.queue` suites. Any failure is a real failure — this project's tests stub Prisma, so none of them needs a database or a network.

- [ ] **Step 2: Type-check and build the backend**

Run: `cd Backend; npm run typecheck; npx nest build`
Expected: both silent. A type error here usually means a Prisma type has not been regenerated — run `npx prisma generate` (offline, no connection) and repeat.

- [ ] **Step 3: Validate the schema and prove the migration is unapplied**

Run: `cd Backend; npx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid`.

Then run: `cd Backend; git status --short prisma`
Expected: `prisma/schema.prisma` modified and `prisma/migrations/0027_crm_lead_routing/` untracked. Nothing about a database appears — `migrate dev`, `db push` and `migrate deploy` were never run in this plan, and the owner applies `0027` at deploy time.

- [ ] **Step 4: Check the hand-written SQL against the schema**

Read `prisma/migrations/0027_crm_lead_routing/migration.sql` beside the diff of `prisma/schema.prisma`, and confirm each line of this list. It is the whole of the audit:

1. `CREATE TYPE "LeadInterest"` and `CREATE TYPE "FollowUpStatus"` with exactly the values the enums declare.
2. `ALTER TABLE "workspace_members"` adds `designation`, `personal_whatsapp`, `last_assigned_at`, and `CREATE INDEX` on `(workspace_id, designation)`.
3. `ALTER TABLE "conversations"` adds `interest` (default `'UNKNOWN'`), `interest_score`, `interest_reason`, `interest_at`, and the index on `(workspace_id, interest, last_message_at)`.
4. `CREATE TABLE "follow_up_tasks"` with every column the model declares, the two foreign keys (`conversation_id` cascade, `assigned_to_user_id` set null, `workspace_id` cascade), both plain indexes, and the partial unique index `follow_up_tasks_one_open_per_conversation` whose `WHERE "status" = 'OPEN'` is what makes one open task per conversation enforceable without a lock.
5. `CREATE TABLE "crm_settings"` with its `workspace_id` primary key, the four columns, and the cascade foreign key.

A column in the model and missing from the SQL (or the reverse) is a bug to fix before the report, not a note to add to it.

- [ ] **Step 5: Run the frontend gates**

Run: `cd frontend; npx tsc --noEmit`
Expected: silent.

Run: `cd frontend; npx eslint . --max-warnings=0`
Expected: silent. `--max-warnings=0` is what makes a warning a failure, which is the house rule.

Run: `cd frontend; npm run build`
Expected: a successful production build listing `/workspace/crm` among the routes. A build that fails only at prerender time is a missing `Suspense` boundary — the page has one for exactly this reason.

- [ ] **Step 6: Collect the diff summary**

Run: `cd .. ; git status --short; git diff --stat`
Expected: the untracked files (the migration folder, the CRM components, the two new pages) plus modified `schema.prisma`, the two module registries, `inbox.view.ts`, `inbox.service.ts`, `list-conversations.dto.ts`, `workspaces.*`, `whatsapp-webhook.service.ts`, `whatsapp.module.ts`, `app.module.ts`, and the frontend's `inbox`/`team` API and component files. Copy the stat block into the report verbatim — a summary that only says "many files" is not a summary.

- [ ] **Step 7: Write the report**

The report answers four questions, in this order, whatever else is said:

1. **Files changed** — grouped backend / frontend / docs, each with a one-line reason. Include the two test files whose expectations changed (`modules.test.ts`, `inbox.queue.test.ts`) and say which expectation moved.
2. **Database changes** — one migration, `0027_crm_lead_routing`, two enums, four columns on `workspace_members`, four on `conversations`, two new tables, three indexes on the new tables plus two partial/plain ones on the altered tables. State plainly: **authored as SQL, not applied.** The owner runs `npx prisma migrate deploy` at deploy time.
3. **Tests run** — the exact commands from Steps 1–5 and their outcome. If any was skipped, say which and why; a gate that did not run is not a gate that passed.
4. **What is deliberately not here** — no commit, no push, no deploy; no `migrate dev`; no AI call in the classifier (it is a phrase table, on purpose); no CSV export of the board; no per-agent routing rules (the spec routes by designation only).

- [ ] **Step 8: Checkpoint**

Run: `git status --short`
Expected: the same tree as Step 6, unchanged by anything this task did. There is nothing to commit, because nothing here is committed: the owner reviews the diff first.

---

## Plan self-review

**Spec coverage.** Each requirement in `Docs/superpowers/specs/2026-11-27-crm-lead-routing-design.md` maps to exactly one task:

| Spec section | Task |
| --- | --- |
| New tables, enums and columns | 1 |
| Interest classification (phrases, thresholds, stickiness, manual) | 2 |
| Round-robin rotation by designation | 3 |
| Member profile: designation and personal number | 4 |
| The `crm` module key and its role defaults | 5 |
| CRM settings, follow-up tasks, `wa.me` link, routes | 6 |
| Pipeline view and manual override | 7 |
| Intake on the inbound path, contact tags, task creation | 8 |
| Inbox read surface: stage fields, open task, filter | 9 |
| The Leads screen | 10 |
| Team screen: the designation column and profile sheet | 11 |
| Inbox stage strip, follow-up strip, overview card | 12 |
| Gates and the owner-facing report | 13 |

**Placeholder scan.** No `TBD`, no "similar to Task N", no "add error handling" without the code. The two places the plan could have hand-waved are written out: the classifier's borrow rule (Task 2) and the partial unique index that makes the one-open-task rule hold under concurrency (Task 1).

**Type consistency.** The names crossing task boundaries were checked once, by hand: `LeadInterest`, `FollowUpStatus` and `FollowUpTaskRef` are declared in `crm/api.ts` (Task 10) and imported — never re-declared — by the inbox (Task 12); `SettingsView`/`PipelineView`/`TaskView` in Tasks 6–7 are what Task 10's frontend types mirror field for field; `memberView` (Task 4) is the single place `Member` is shaped, and Task 11's type adds only the two fields the server already sends; `conversationView` (Task 9) is the single place `Conversation` gains the stage, and every consumer reads it through `Conversation`, not a copy.

**The three rulings** at the top of this document are the only places the plan departs from a literal reading of the spec. Each was made where the literal reading would have produced a defect (cumulative scoring, a customer-facing note, a task without a title) and each is stated in one line so a reviewer can overturn it in one place.
