# CRM lead routing — hand-off report

Plan: `Docs/superpowers/plans/2026-11-27-crm-lead-routing.md`
Spec: `Docs/superpowers/specs/2026-11-27-crm-lead-routing-design.md`
Execution ledger: `.superpowers/sdd/2026-11-27-crm-lead-routing/progress.md` (every ruling, every review round)

## Read this first: the working tree is no longer uncommitted

This plan was executed under a standing instruction not to commit, push or
deploy. I did not run `git commit` or `git push`. An external process — the
IDE's checkpointing, not a command I issued — committed the work and pushed
it to `origin/main`, five times:

```
de5a809 feat(crm): fallback task assignee to owner if assignee left workspace
8c754d5 feat(crm): add manager task creation and lead routing enhancements
9e8f31f feat(inbox): prevent outdated poll results from overwriting latest writes
658ef12 feat(crm): implement lead interest stages and follow-up integration
049a11a feat(crm): add CRM lead routing, follow-ups, and routing settings
```

`8c754d5` was made while the final review's fix round was in progress, so it
captured that round's first pass. The second pass — the removal/creation race,
four files — was checkpointed as `de5a809` shortly after it was written, so no
code from this plan is uncommitted now; only this report is. `main` ==
`origin/main` == `de5a809`. I did not rewrite history to undo any of this: it
had already reached the remote, and a reset/force-push is a destructive
operation that needs your decision. The diff summary below is
`git diff 7337b19` (this report file excluded) — `7337b19` is the last commit
before this work — so it contains every fix.

## 1. Files changed

58 files, +10,539 / −31 lines — this report file is not counted, because it
grows every time it is edited (with it, the diff covers 59 files). Grouped:

### Backend

- `prisma/schema.prisma` — `LeadInterest`/`FollowUpStatus` enums, three member
  columns, four conversation columns, `FollowUpTask`, `CrmSettings`, indexes.
- `prisma/migrations/0027_crm_lead_routing/migration.sql` — the same DDL by
  hand, including the partial unique index Prisma cannot express.
- `src/crm/` (new) — `interest.rules.ts` (phrase table classifier, AI-free),
  `round.robin.ts` (designation rotation), `crm.settings.ts`, `tasks.service.ts`
  (creation, dedupe, the manager's board errand, the `wa.me` link),
  `crm.pipeline.ts` (board derivation), `crm.service.ts`, `crm.dto.ts`,
  `crm.controller.ts`, `crm.module.ts`, and the intake hook `lead.intake.ts`;
  eight test files beside them.
- `src/auth/users.service.ts` — a stored, team-edited name is no longer
  overwritten by provider metadata on every token sync.
- `src/inbox/` — `dto/list-conversations.dto.ts` (`interest`, `followUp`),
  `inbox.service.ts` (both predicates), `inbox.view.ts` (stage fields and the
  open task on every conversation), `inbox.queue.test.ts` (fixture fields,
  stage filter, two follow-up-filter tests).
- `src/workspaces/` — `workspaces.service.ts` (`memberView`, `updateProfile`,
  `AccessView.hasPersonalWhatsApp`, and `remove`, which releases a departing
  member's work), `workspaces.controller.ts`
  (`PATCH members/:userId/profile`), `dto/team.dto.ts`, `modules.ts` (`crm`
  key), `modules.test.ts` (the ADMIN/MANAGER/AGENT expectations moved; one new
  role-boundary test), `team.dto.test.ts` (new).
- `src/whatsapp/` — `whatsapp-webhook.service.ts` (intake after enqueue, in its
  own try/catch), `whatsapp.module.ts` (imports `CrmModule`).
- `src/app.module.ts` — wires `CrmModule`.

### Frontend

- `features/crm/` (new) — `api.ts`, `format.ts`, `crm-view.tsx` (tabs, three
  independent module-gated reads), `pipeline-board.tsx` (with the card's
  Follow up action), `task-list.tsx`, `routing-settings.tsx`, `interest-chip.tsx`,
  `follow-up-strip.tsx`, `follow-ups-card.tsx`;
  `app/(app)/workspace/crm/page.tsx`.
- `features/inbox/` — `api.ts` (stage fields, `interest`/`followUp` filters),
  `conversation-list.tsx` (stage menu incl. the derived Follow-up row, row
  chip, summary, empty state), `message-thread.tsx` (stage chip and follow-up
  strip; `onWritten`), `inbox-view.tsx` (`revision` sequencing of reads and
  writes; `handleWritten`).
- `features/team/` — `api.ts` (`designation`, `personalWhatsApp`,
  `updateMemberProfile`), `member-profile-sheet.tsx` (new), `team-view.tsx`
  (Designation column, owner edit including their own row, sheet mount),
  `app/(app)/workspace/team/page.tsx`.
- `config/modules.ts`, `config/workspace-nav.ts` — the `crm` key and the Leads
  nav entry.
- `lib/access/api.ts`, `components/workspace/access-provider.tsx` — the
  personal-number eligibility boolean.
- `app/(app)/workspace/page.tsx` — the "Your follow-ups" card.

### Docs

- `Docs/superpowers/specs/2026-11-27-crm-lead-routing-design.md` (approved spec;
  its "Assignee leaves the workspace" failure mode was reconciled with the
  implementation during the final fix round)
- `Docs/superpowers/plans/2026-11-27-crm-lead-routing.md` (this plan)
- this report.

## 2. Database changes

One migration, `0027_crm_lead_routing`. **Authored as SQL, not applied.** Run
`npx prisma migrate deploy` at deploy time; `migrate dev` and `db push` were
never run.

- Two enums: `LeadInterest ('UNKNOWN','INTERESTED','NOT_INTERESTED')`,
  `FollowUpStatus ('OPEN','DONE','CANCELLED')`.
- `workspace_members`: `designation`, `personal_whatsapp`, `last_assigned_at`
  (three columns — the plan says "four", which is a counting slip in the plan
  text; the three here match the model), plus an index on
  `(workspace_id, designation)`.
- `conversations`: `interest` (default `'UNKNOWN'`), `interest_score`,
  `interest_reason`, `interest_at`, plus an index on
  `(workspace_id, interest, last_message_at)`.
- `follow_up_tasks` (new): every column the model declares; FKs to
  `workspaces` and `conversations` (cascade) and `users` (set null); indexes on
  `(workspace_id, status, due_at)` and `(assigned_to_user_id, status)`; the
  partial unique index `follow_up_tasks_one_open_per_conversation` on
  `(conversation_id) WHERE status = 'OPEN'`.
- `crm_settings` (new): `workspace_id` primary key, `lead_designation`,
  `auto_assign` (default true), `auto_task` (default true), `task_due_hours`
  (default 24), timestamps; cascade FK to `workspaces`.

The Step 4 checklist was walked line by line against the schema diff; no
column, default, index or foreign key differs between model and SQL.

## 3. Tests run

All commands run on the final content, in this order:

| Command | Result |
| --- | --- |
| `cd Backend; npm test` | 370 tests, 370 pass, 0 fail |
| `cd Backend; npm run typecheck` | exit 0, silent |
| `cd Backend; npx nest build` | exit 0, silent |
| `cd Backend; npx prisma validate` | `The schema at prisma\schema.prisma is valid` |
| `cd frontend; npx tsc --noEmit` | exit 0, silent |
| `cd frontend; npx eslint . --max-warnings=0` | exit 0, silent |
| `cd frontend; npm run build` | exit 0, `/workspace/crm` in the route table |

New suites: `interest.rules`, `round.robin`, `team.dto`, `crm.dto`,
`crm.settings`, `tasks.service`, `crm.pipeline`, `lead.intake`. Extended:
`inbox.queue` (conversation fixture gained the stage fields; stage filter;
two follow-up-filter tests), `modules` (three role expectations moved, one
new role-boundary test), `lead.intake` (a refusal landing during the insert),
and `tasks.service` (board creation, its 409/404 answers, the owner fallback
when an assignee has left). All backend tests stub Prisma; none needs a
database or a network.

## 4. What is deliberately not here

- No commit or push by me — see the note at the top; the external checkpoint
  did both.
- No `migrate dev`, `db push` or `migrate deploy`.
- No AI call anywhere in the classifier: it is a phrase table, on purpose.
- No CSV export of the board.
- No per-agent routing rules; the spec routes by designation only.
- No email editing in the member sheet (read-only, with the reason).

## Diff summary

Verbatim `git diff --stat 7337b19 -- . ":(exclude)Docs/superpowers/reports"`,
with this report left out so the numbers stay stable:

```
 .../migrations/0027_crm_lead_routing/migration.sql |   88 +
 Backend/prisma/schema.prisma                       |   82 +
 Backend/src/app.module.ts                          |    2 +
 Backend/src/auth/users.service.ts                  |    6 +-
 Backend/src/crm/crm.controller.ts                  |  120 +
 Backend/src/crm/crm.dto.test.ts                    |   48 +
 Backend/src/crm/crm.dto.ts                         |   67 +
 Backend/src/crm/crm.module.ts                      |   26 +
 Backend/src/crm/crm.pipeline.test.ts               |   23 +
 Backend/src/crm/crm.pipeline.ts                    |   24 +
 Backend/src/crm/crm.service.ts                     |  103 +
 Backend/src/crm/crm.settings.test.ts               |   67 +
 Backend/src/crm/crm.settings.ts                    |  136 +
 Backend/src/crm/interest.rules.test.ts             |  218 +
 Backend/src/crm/interest.rules.ts                  |  320 ++
 Backend/src/crm/lead.intake.test.ts                |  279 ++
 Backend/src/crm/lead.intake.ts                     |  233 +
 Backend/src/crm/round.robin.test.ts                |   34 +
 Backend/src/crm/round.robin.ts                     |   60 +
 Backend/src/crm/tasks.service.test.ts              |  283 ++
 Backend/src/crm/tasks.service.ts                   |  381 ++
 Backend/src/inbox/dto/list-conversations.dto.ts    |   14 +
 Backend/src/inbox/inbox.queue.test.ts              |   47 +
 Backend/src/inbox/inbox.service.ts                 |   10 +
 Backend/src/inbox/inbox.view.ts                    |   37 +
 Backend/src/whatsapp/whatsapp-webhook.service.ts   |   14 +
 Backend/src/whatsapp/whatsapp.module.ts            |    6 +-
 Backend/src/workspaces/dto/team.dto.ts             |   40 +
 Backend/src/workspaces/modules.test.ts             |   11 +-
 Backend/src/workspaces/modules.ts                  |    5 +-
 Backend/src/workspaces/team.dto.test.ts            |   39 +
 Backend/src/workspaces/workspaces.controller.ts    |   18 +
 Backend/src/workspaces/workspaces.service.ts       |  174 +-
 .../plans/2026-11-27-crm-lead-routing.md           | 5089 ++++++++++++++++++++
 .../specs/2026-11-27-crm-lead-routing-design.md    |  463 ++
 frontend/src/app/(app)/workspace/crm/page.tsx      |   48 +
 frontend/src/app/(app)/workspace/page.tsx          |    3 +
 frontend/src/app/(app)/workspace/team/page.tsx     |    2 +-
 .../src/components/workspace/access-provider.tsx   |    6 +
 frontend/src/config/modules.ts                     |    3 +
 frontend/src/config/workspace-nav.ts               |    8 +
 frontend/src/features/crm/api.ts                   |  154 +
 frontend/src/features/crm/components/crm-view.tsx  |  384 ++
 .../features/crm/components/follow-up-strip.tsx    |  158 +
 .../features/crm/components/follow-ups-card.tsx    |  117 +
 .../src/features/crm/components/interest-chip.tsx  |  122 +
 .../src/features/crm/components/pipeline-board.tsx |  149 +
 .../features/crm/components/routing-settings.tsx   |  166 +
 frontend/src/features/crm/components/task-list.tsx |  181 +
 frontend/src/features/crm/format.ts                |   15 +
 frontend/src/features/inbox/api.ts                 |   18 +
 .../inbox/components/conversation-list.tsx         |   91 +-
 .../src/features/inbox/components/inbox-view.tsx   |   50 +-
 .../features/inbox/components/message-thread.tsx   |   24 +
 frontend/src/features/team/api.ts                  |   26 +
 .../team/components/member-profile-sheet.tsx       |  220 +
 .../src/features/team/components/team-view.tsx     |   51 +
 frontend/src/lib/access/api.ts                     |    7 +
 58 files changed, 10539 insertions(+), 31 deletions(-)
```

## The final whole-branch review's five findings

The final review read `git diff 7337b19 HEAD` and returned five MAJOR items.
All five are fixed and the scoped re-review passed them one by one:

1. **Intake could recreate a task after a manual refusal.** The stage write
   was guarded, the `tasks.create` after it was not. Post-insert, the pass
   re-reads the stage and cancels the task it just created when the thread is
   no longer `INTERESTED`; a refusal that lands after the insert cancels the
   row itself. Interactive transactions are banned on this pooler, so a
   conditional write is the strongest form available.
2. **The owner could not set their own personal number.** The pencil is now on
   every manageable row; the sheet hides designation for the owner (rotation
   excludes them) and keeps the name and the number, because the owner is the
   fallback assignee.
3. **`syncFromClaims` undid a name edited on the Team screen.** Provider
   metadata now seeds a new row only; a stored name belongs to the team.
   Trade-off: a never-edited name will not follow a provider-side rename.
4. **Removing a member orphaned their OPEN tasks.** `FollowUpTask.assignedTo`
   points at `User`, so `SetNull` never fires on a membership delete. Removal
   now releases the member's work before the delete and again after it, and
   every task creation re-checks membership after inserting and falls back to
   the owner. The spec's failure-mode bullet was rewritten to state this
   (it previously promised `SetNull` alone). The residual crash window between
   the delete and the second release is disclosed, not hidden.
5. **There was no way for a manager to create a task from the board.** Added
   `POST /v1/crm/conversations/:id/tasks` (module `crm`, MANAGER+), deriving
   title, reason, deadline and assignee on the server through the same
   `TasksService.create` intake uses (409 `TASK_EXISTS`, 404 across tenants),
   with a "Follow up" action on the board card.

## Where the plan was overruled (short form)

The ledger has each ruling with its cost. The ones a reviewer should know:

- `wa.me` carries the **customer's** number; the member's personal number is
  only the eligibility gate. The plan and its test had the member messaging
  themselves.
- The classifier's reason never reaches the customer; the follow-up text is
  built from the task title, not the classifier note.
- The inbox "Follow-up" stage is a derived query parameter
  (`followUp=open` = interested + an OPEN task), not a fourth `interest`
  value. The stage menu keeps the stored "New" row as well.
- The member profile sheet has a read-only email with the reason, and the
  personal number is monospace — both are in the spec and were missing from
  the plan's code.
- A CRM write forwards no client-side snapshot: the parent re-reads the row
  and sequences it against the 3-second poll with a single revision counter.

## What to do next

1. Read the diff (or the five commits above, `049a11a` … `de5a809`) and this
   report.
2. Apply `0027_crm_lead_routing` with `npx prisma migrate deploy` in the target
   environment, then `npx prisma generate`.
3. Decide whether the five pushed commits (`049a11a`, `658ef12`, `9e8f31f`,
   `8c754d5`, `de5a809`) stay as they are, are squashed, or are reverted —
   that call is yours; I did not touch history. Only this report is
   uncommitted.
