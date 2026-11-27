# CRM lead routing + member profiles — design

Status: awaiting review. Scope: per-member profile fields, a local interest
classifier, round-robin lead assignment and `wa.me` follow-ups. WhatsApp
channel only; no external AI service.

## Goal

An incoming customer message is read by a local rule engine and given a stage:
Interested, Not interested, or (while nothing is known) New. An interested lead
that belongs to nobody is handed to the next available member **with the right
designation**, and a follow-up task is created for that person. Everybody in the
workspace can see the stage and the task in the thread they already use, while a
manager gets a board of every lead and the owner decides who receives leads and
what a member's designation is.

## What this is not

Not a campaign engine. Not a deal/quote/order system: there is no amount, no
product line, no won/lost. Not a second inbox or a parallel message store — a
lead is a conversation plus a stage. Not programmatic sending from a personal
number (impossible; see "Personal WhatsApp"). Not an NLU service: the classifier
is a deterministic scorer, not a model.

Phases: 1 profile fields, 2 classifier, 3 intake + round-robin, 4 tasks, 5 CRM
board, 6 overview card.

## Decisions taken

| Decision | Choice | Why |
| --- | --- | --- |
| Classifier | Weighted phrase profiles + structural signals | Deterministic, explainable (`interestReason`), unit-testable, no runtime or network. A model would need a bundled dependency and still could not say why |
| Negative stickiness | `stop`-class phrases never auto-clear; a refusal clears only on a strong buying phrase | One "ok" must not resurrect a customer who asked to be left alone |
| Rotation trigger | Only a lead that is Interested **and** unassigned | A returning customer keeps their agent; an assigned thread is never stolen; no need for a second reopen rule |
| Rotation state | `WorkspaceMember.lastAssignedAt` cursor | No new table. `UPDATE … RETURNING` with `SKIP LOCKED` is atomic without an interactive transaction, which the Supabase pooler cannot carry |
| Rotation roster | Members with the matching designation, excluding the OWNER | The owner runs the workspace; rotating the owner in would silently steal leads from the people hired for it |
| Which designation | `CrmSettings.leadDesignation`; if unset and the roster has exactly one distinct designation, use it | No magic: several designations and no setting means no auto-assignment, stated on screen |
| Task unit | New `FollowUpTask`, one OPEN per conversation | A closed task may be replaced; a retried delivery must not create twins. Enforced by a partial unique index |
| Personal WhatsApp | `wa.me` deep link built server-side + an `InternalNote` | The only supported way to message from a personal number. Logging makes the thread truthful about what happened |
| Pipeline UI | Inbox chips + `/workspace/crm` board | Agents answer messages where they already are; managers need the board; nobody has to switch screens to reply |
| Module key | New `crm` (ADMIN, MANAGER by default) | Matches the PRD's division of labour; the owner can grant it to AGENT |
| Member name | Owner edits `User.fullName` (shared), designation and number on the membership | Designation is a team role, not an identity |
| Member email | Read-only | `User.email` is the Supabase auth identity; changing it from a workspace screen would break sign-in until re-verified |

## Data model — migration `0027_crm_lead_routing`

```prisma
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

model WorkspaceMember {
  // existing: workspaceId, userId, role, createdAt
  /// Free text: "Sales Executive", "Support Agent". Filters round-robin.
  designation      String?   @map("designation")
  /// Digits only, like Contact.waId. Country code included, no "+".
  personalWhatsApp String?   @map("personal_whatsapp")
  /// Round-robin cursor. Oldest wins; null sorts first.
  lastAssignedAt   DateTime? @map("last_assigned_at")

  @@index([workspaceId, designation])
}

model Conversation {
  // existing fields unchanged
  interest       LeadInterest @default(UNKNOWN)
  interestScore  Int?         @map("interest_score")
  /// The phrase that decided it, or the reason nothing did.
  interestReason String?      @map("interest_reason")
  interestAt     DateTime?    @map("interest_at")

  @@index([workspaceId, interest, lastMessageAt])
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

  workspace    Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  conversation Conversation  @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  assignedTo   User?         @relation("TaskAssignee", fields: [assignedToUserId], references: [id], onDelete: SetNull)

  @@index([workspaceId, status, dueAt])
  @@index([assignedToUserId, status])
}

/// Same shape as BusinessProfile: the workspace id is the key.
model CrmSettings {
  workspaceId     String   @id @map("workspace_id") @db.Uuid
  leadDesignation String?  @map("lead_designation")
  autoAssign      Boolean  @default(true) @map("auto_assign")
  autoTask        Boolean  @default(true) @map("auto_task")
  taskDueHours    Int      @default(24) @map("task_due_hours")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
}
```

`User` gains `tasks FollowUpTask[] @relation("TaskAssignee")`; `Workspace` gains
`followUpTasks` and `crmSettings`; `Conversation` gains
`followUpTasks FollowUpTask[]` — Prisma needs the back-relation on both sides,
and it is what lets `ConversationView.openTask` be one include instead of a
query per row.

Raw SQL in the same migration, both hand-written:

```sql
-- One open task per thread: a retried delivery or a second "price?" message
-- must update the existing task, never stack a second one.
CREATE UNIQUE INDEX follow_up_tasks_one_open_per_conversation
  ON follow_up_tasks (conversation_id)
  WHERE status = 'OPEN';

-- Existing conversations start as UNKNOWN with no timestamp: the default covers
-- them, and no backfill is written into a migration.
```

No data migration. `follow_up_tasks` and `crm_settings` are created empty, and
the "table may be absent" tolerance the module toggles needed is unnecessary
here: nothing reads these tables before the migration is applied except the new
module itself, which is what creates them.

## Interest classifier

`Backend/src/crm/interest.rules.ts` — one pure function, no I/O:

```
classify(
  body: string,
  previous: { stage: LeadInterest; score: number | null; body: string | null },
): { interest: LeadInterest; score: number; reason: string }
```

The caller passes the thread's stored stage, its last score and its previous
inbound body; the function itself reads nothing.

Normalise first: lowercase, strip diacritics, collapse punctuation runs to single
spaces (the same trick as `bots/bot.rules.ts` `wordsOf`), collapse whitespace.
Match whole phrases against the normalised text.

| Profile | Examples | Weight |
| --- | --- | --- |
| `STOP` | stop messaging, stop sending, do not message, remove my number, unsubscribe | −4 |
| `REFUSAL` | not interested, no interest, already bought, already have, no need, not required, wrong number | −3 |
| `SOFT_NO` | not now, maybe later, busy, will think | −1 |
| `BUYING` | price, cost, how much, rate, quote, quotation, available, stock, demo, sample, catalogue, brochure, order, subscribe, details | +3 |
| `CONTACT` | call me, send me, my number, email me | +2 |
| `URGENCY` | today, now, urgent, asap | +1 |

Structural signals add at most +3 together: a trailing `?` (+1), a currency token
(`₹`, `rs`, `inr`, `aed`, `$`) (+1), a quantity (`3 pcs`, `10 boxes`) (+1).

Verdict: score ≥ **+3** → `INTERESTED`, ≤ **−3** → `NOT_INTERESTED`, otherwise
`UNKNOWN`. Score is clamped to ±100 and stored with the verdict, so a later
threshold change is visible in the data rather than silently rewriting history.

`reason` names the deciding phrase (`matched "how much"`) or the absence
(`no buying or refusal signal`). A wrong guess is therefore readable in the
thread and fixable by editing the profile list.

Stickiness, which is where a naive matcher goes wrong:

- Current stage `NOT_INTERESTED` from `STOP` clears **only** on a `BUYING` match.
- Current stage `NOT_INTERESTED` from `REFUSAL` clears on `BUYING` or `CONTACT`.
- `UNKNOWN` and `INTERESTED` re-evaluate every new inbound.
- A message shorter than four words borrows the previous inbound score, so
  "how much?" → "₹200" → "ok" keeps the lead interested instead of dropping it.
- A message with no match at all never moves a stage backwards; only a negative
  match does.

Language: English profiles plus the transliterated Hinglish terms that appear in
the same conversations (`kitna`, `rate kya`, `chahiye`, `nahi chahiye`). No
language detection and no translation call.

## Lead intake

`Backend/src/crm/lead.intake.ts`, called from `whatsapp-webhook.service.ts`
immediately after `InboxStore.record()` returns, beside `ReplyIntake.enqueue()`.
Same rule as the AI enqueue: **wrapped in try/catch, logged, never answered to
Meta as a failure** — a CRM bug must not make Meta retry a stored message.

Per `StoredInbound` row with a real text body:

1. Load the conversation's current stage, assignee, workspace account and the
   previous inbound body (one query with includes).
2. `classify()`.
3. Write `interest`, `interestScore`, `interestReason`, `interestAt`; mirror
   `Contact.tags` (`interested` added, `not-interested` added, the other removed).
4. `INTERESTED`, no assignee, `autoAssign` on → `roundRobin.pick()`. If it
   returns a user, set `assignedToUserId`.
5. `INTERESTED`, `autoTask` on, no OPEN task for this conversation →
   `FollowUpTask.create()` due `now + taskDueHours`, assigned to the pick (or to
   the owner when nobody could be picked).
6. `NOT_INTERESTED` → cancel OPEN tasks for the thread, clear nothing else; the
   thread stays in the inbox as history.
7. `UNKNOWN` → nothing but the stored stage fields.

Idempotency comes from the stored data, not from a transaction: only rows in
`StoredInbound` (i.e. newly inserted messages) are considered, the open-task
condition is the partial unique index on `follow_up_tasks (conversation_id)`
where `status = 'OPEN'`, and an existing assignee is never overwritten
(`updateMany … where assignedToUserId: null`).

Cost: two reads and at most three writes, all indexed, all local. It does not
touch Meta.

## Round-robin

`Backend/src/crm/round.robin.ts`, one statement:

```sql
UPDATE workspace_members
   SET last_assigned_at = now()
 WHERE (workspace_id, user_id) = (
   SELECT workspace_id, user_id
     FROM workspace_members
    WHERE workspace_id = $1
      AND role <> 'OWNER'
      AND designation = $2
    ORDER BY last_assigned_at ASC NULLS FIRST, user_id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
 )
RETURNING user_id;
```

Called only with a resolved designation. The caller resolves it:

1. `CrmSettings.leadDesignation`, when set.
2. Otherwise the single distinct non-null designation on the roster, if there is
   exactly one.
3. Otherwise no rotation: the lead stays unassigned and the task goes to the
   owner, whose name the thread shows.

A null result after a valid designation means every matching member has just been
picked in the same instant; the lead waits for the next message rather than
piling onto one agent.

`lastAssignedAt` is written **only** here. A manual assignment in the inbox does
not move the cursor, so a manager handing a thread over cannot skew the rotation.

## Stages

A conversation's board column is derived, never stored twice:

| Stored state | Column |
| --- | --- |
| `UNKNOWN` | New |
| `INTERESTED`, no OPEN task | Interested |
| `INTERESTED`, OPEN task | Follow-up — overdue once `dueAt < now` |
| `NOT_INTERESTED` | Not interested, hidden from the active board |

A manual override sets the stage and stops intake from reversing it for 24
hours, so a manager's decision is not undone by the customer's next "ok".

## Tasks

- Created only by intake, or by a manager from the board. Both take the same
  `createTask()` helper so dedupe is central.
- `title`: `Follow up with {contact name or number}`; `note`: the reason
  (`Interested: matched "how much"`).
- Due: `CrmSettings.taskDueHours` (24 by default) from creation.
- `PATCH` accepts `status` and `dueAt`. `DONE` stamps `completedAt`; `CANCELLED`
  does not, because nobody did the work.
- An AGENT may change only tasks assigned to them; MANAGER and above may change
  any task in the workspace.

## Personal WhatsApp

`POST /v1/crm/tasks/:id/wa-link` returns `{ url, note }`.

- Number: the signed-in member's `personalWhatsApp`. Digits only, 8–15 long,
  leading `00` stripped. Missing or malformed → 409 `NO_PERSONAL_NUMBER` naming
  the owner, who sets it on the Team screen.
- Text: built on the server so the wording is one place —

  ```
  Hi {contact profile name or "there"}, {agent first name} from {workspace name}
  here about your enquiry. {task note}
  ```

  then `encodeURIComponent`. The workspace name is read from the workspace row;
  nothing is hardcoded.
- URL: `https://wa.me/{digits}?text={encoded}`.
- The response also writes an `InternalNote` authored by the member:
  `Follow-up on personal WhatsApp: {text}`. The browser opens the link on a
  click — no popup blocker, no window the customer's number leaks into.
- The button is `target="_blank" rel="noreferrer"`.

What it cannot do, stated on the screen too: nothing confirms the message was
sent, the customer's reply arrives on the employee's personal WhatsApp rather
than in this inbox, and the thread only continues here when the customer messages
the business number again. A genuinely programmatic personal channel means one
verified Cloud API number per employee (registration, templates, per-seat
billing) and is out of scope.

## API — `Backend/src/crm/`

| File | Contents |
| --- | --- |
| `interest.rules.ts` | `classify`, profile tables, thresholds |
| `interest.rules.test.ts` | fixtures per profile and sticky transition |
| `round.robin.ts` | `pick(workspaceId, designation)`, raw statement |
| `lead.intake.ts` | `consider(account, stored)`; the seven steps above |
| `lead.intake.test.ts` | stubbed Prisma: writes, no-op paths, dedupe |
| `tasks.service.ts` | `createTask`, `list`, `update`, `waLink` |
| `crm.dto.ts` | `SetInterestDto`, `UpdateTaskDto`, `CrmSettingsDto` |
| `crm.controller.ts` | routes below |
| `crm.module.ts` | exports `LeadIntake` for the webhook module |

| Route | Guards | Notes |
| --- | --- | --- |
| `GET /v1/crm/pipeline` | `@RequiresModule("crm")` | Stages, counts, rows with contact, assignee, task |
| `PUT /v1/crm/conversations/:id/interest` | `@RequiresModule("crm") @Roles("MANAGER")` | Manual override; writes reason `manual` |
| `GET /v1/crm/tasks?scope=mine\|all` | `@RequiresModule("inbox")` | `all` needs `@Roles("MANAGER")`; mine needs nothing but membership |
| `PATCH /v1/crm/tasks/:id` | `@RequiresModule("inbox")` | Own task, or MANAGER+ |
| `POST /v1/crm/tasks/:id/wa-link` | `@RequiresModule("inbox")` | Own task only |
| `GET /v1/crm/settings` | `@Roles("OWNER")` | Includes the distinct designations on the roster |
| `PUT /v1/crm/settings` | `@Roles("OWNER")` | Validates `taskDueHours` 1–720 |

Tasks are gated on `inbox`, not `crm`, because an agent's own follow-ups must
not require the pipeline module. Every query is scoped by the `workspaceId`
resolved through `primaryFor` — never a workspace id from the body.

## Team profile

- `PATCH /v1/workspaces/members/:userId/profile`, `@Roles("OWNER")`, body
  `{ fullName?, designation?, personalWhatsApp? }` — all optional, `null` clears.
  Name writes `User.fullName`; the other two write the membership row.
- `designation`: trimmed, 1–40 characters, or null.
- `personalWhatsApp`: digits only after stripping spaces, `+`, `-`, `(`, `)`;
  length 8–15; stored without a leading `+`.
- `MemberView` gains `designation` and `personalWhatsApp`, so the members table
  needs no second read.
- Email stays out of the DTO. The Team screen shows it read-only with the reason.

## Inbox changes

- `ListConversationsDto` gains `interest?: LeadInterest`; `inbox.service.list`
  adds it to the where-clause the same way `status` is added.
- `ConversationView` gains `interest`, `interestScore`, `interestReason` and
  `openTask: { id, dueAt, status } | null` — one include served by the partial
  unique index on open tasks, no extra query per row.
- Nothing else in the inbox changes: sending, media, notes, the AI agent's
  behaviour and the 24-hour window are untouched. A bot reply and a lead
  assignment can coexist; the bot answers the customer, the task tells a human
  to follow up.

## Screens

1. **Team & Permissions → Members.** New "Designation" column (dash when unset)
   and a row action that opens a dialog: full name, designation, personal
   WhatsApp (digits, monospace, with the country-code hint), email read-only.
   Owner only; a member sees the same table without the action.
2. **Team & Permissions → Permissions.** A "Lead routing" card under the module
   matrix: designation picker (distinct roster designations), *Assign new
   interested leads automatically*, *Create a follow-up task*, due-hours field.
   Says plainly when no designation is chosen and why nothing will rotate.
3. **Inbox → list.** "Interest" joins the existing filter menu (Any, Interested,
   Follow-up, Not interested). An interested row gets a small chip; nothing is
   recoloured or reordered.
4. **Inbox → thread.** Interest chip with the reason on hover or expand, override
   menu for MANAGER+; a follow-up strip under the header: title, due, "Send from
   my WhatsApp" (disabled with the reason when no number), "Mark done". Overdue
   is stated in words, not colour alone.
5. **`/workspace/crm`.** New nav item, module `crm`. Tabs: **Pipeline**
   (New → Interested → Follow-up due → Not interested, cards are conversations,
   click opens the inbox thread), **My follow-ups** (the same list the overview
   card shows), **Settings** (owner only, same data as the Permissions card; the
   card links here).
6. **Overview.** "Your follow-ups" card for every role — the overview is
   deliberately not a module, so this is the agent's task list without handing
   them the whole pipeline.

## Permissions

| Action | OWNER | ADMIN | MANAGER | AGENT |
| --- | --- | --- | --- | --- |
| See interest chip in a thread | ✓ | ✓ | ✓ | ✓ |
| Own follow-up tasks | ✓ | ✓ | ✓ | ✓ |
| Override a stage | ✓ | ✓ | ✓ | — |
| CRM board (`crm` module on) | ✓ | ✓ | ✓ | — |
| Reassign a lead | ✓ | ✓ | ✓ | own thread only (existing rule) |
| Edit member profile | ✓ | — | — | — |
| Lead routing settings | ✓ | — | — | — |

Module defaults: `crm` added for ADMIN and MANAGER, absent for AGENT. That
changes `modules.test.ts`, deliberately: the test encodes the division of labour
and gains one entry rather than being loosened.

## Failure modes

- **Webhook slowness.** Classification is local and bounded; two reads and three
  writes. No Meta call, no model, no loop over history.
- **Retries.** Dedupe rests on `StoredInbound` (new rows only), `assignedToUserId
  IS NULL` and the partial unique index on open tasks.
- **No designation configured.** No rotation, no silently wrong assignment; the
  lead stays unassigned and the task names the owner.
- **Assignee leaves the workspace.** `onDelete: SetNull` on both relations keeps
  the task and the conversation; the strip shows "unassigned" and the board
  offers reassignment.
- **Classifier wrong.** The reason is visible in the thread and overridable; an
  override writes `interestReason = "manual"` and intake never silently reverses
  a manual stage for the next 24 hours.
- **Two leads at once.** `FOR UPDATE SKIP LOCKED` guarantees two different
  members, or one member and a wait.
- **Existing conversations.** All start `UNKNOWN`. A one-off, owner-run script
  can classify the last message of recent threads; it is not part of the
  migration.

## Configuration

No new environment variables. One migration, applied with
`prisma migrate deploy` (never `migrate dev` or `db push`). The new module key
needs `MODULE_KEYS`, `MODULE_LABELS` and `MODULE_DEFAULTS` in
`Backend/src/workspaces/modules.ts`, mirrors in
`frontend/src/config/modules.ts`, and a `/workspace/crm` entry in
`workspace-nav.ts` (`moduleForPath` must map it).

## Test plan

- `interest.rules.test.ts`: one fixture per profile, threshold boundaries, the
  short-reply borrow, both sticky transitions, a no-match message that must not
  move a stage.
- `lead.intake.test.ts` with a stubbed Prisma: Interested writes stage + assigns
  + creates one task; a second call creates no second task; Not interested
  cancels open tasks and assigns nobody; Unknown writes only stage fields;
  `autoAssign: false` leaves it unassigned; a throwing write is swallowed.
- `round.robin` ordering predicate as a pure helper over in-memory rows (nulls
  first, then oldest, then id) — the raw statement itself is not unit-tested.
- `workspaces` DTO tests: phone normalisation rejects 7 digits and letters,
  accepts `+91 98765 43210`; designation length; email absent from the DTO.
- `modules.test.ts` updated for the new key in the three defaults.
- Frontend gates: `tsc --noEmit`, `eslint --max-warnings=0`, `next build`.
- Backend gates: `tsc`, `npm test` (290 + new), `nest build`.

## Open questions

None blocking. Two deferred by decision: a per-workspace editable rule profile
(a JSON column over the code defaults) and the per-employee Cloud API number.
