# CRM lead routing — hand-off report

Plan: `Docs/superpowers/plans/2026-11-27-crm-lead-routing.md`
Spec: `Docs/superpowers/specs/2026-11-27-crm-lead-routing-design.md`
Execution ledger: `.superpowers/sdd/2026-11-27-crm-lead-routing/progress.md` (every ruling, every review round)

## Read this first: the working tree is no longer uncommitted

This plan was executed under a standing instruction not to commit, push or
deploy. I did not run `git commit` or `git push`. During the last task an
external process — the IDE's checkpointing, not a command I issued —
committed the work and pushed it to `origin/main`:

```
9e8f31f feat(inbox): prevent outdated poll results from overwriting latest writes
658ef12 feat(crm): implement lead interest stages and follow-up integration
049a11a feat(crm): add CRM lead routing, follow-ups, and routing settings
```

`main` and `origin/main` both point at `9e8f31f`, and the tree is clean. I did
not rewrite history to undo this: it had already reached the remote, and a
reset/force-push is a destructive operation that needs your decision. The
committed content is exactly the reviewed content; the diff summary below is
`git diff 7337b19 HEAD`, where `7337b19` is the last commit before this work.

## 1. Files changed

57 files, +10,198 / −28 lines. Grouped:

### Backend

- `prisma/schema.prisma` — `LeadInterest`/`FollowUpStatus` enums, three member
  columns, four conversation columns, `FollowUpTask`, `CrmSettings`, indexes.
- `prisma/migrations/0027_crm_lead_routing/migration.sql` — the same DDL by
  hand, including the partial unique index Prisma cannot express.
- `src/crm/` (new) — `interest.rules.ts` (phrase table classifier, AI-free),
  `round.robin.ts` (designation rotation), `crm.settings.ts`, `tasks.service.ts`
  (creation, dedupe, `wa.me` link), `crm.pipeline.ts` (board derivation),
  `crm.service.ts`, `crm.dto.ts`, `crm.controller.ts`, `crm.module.ts`, and the
  intake hook `lead.intake.ts`; eight test files beside them.
- `src/inbox/` — `dto/list-conversations.dto.ts` (`interest`, `followUp`),
  `inbox.service.ts` (both predicates), `inbox.view.ts` (stage fields and the
  open task on every conversation), `inbox.queue.test.ts` (fixture fields,
  stage filter, two follow-up-filter tests).
- `src/workspaces/` — `workspaces.service.ts` (`memberView`, `updateProfile`,
  `AccessView.hasPersonalWhatsApp`), `workspaces.controller.ts`
  (`PATCH members/:userId/profile`), `dto/team.dto.ts`, `modules.ts` (`crm`
  key), `modules.test.ts` (the ADMIN/MANAGER/AGENT expectations moved; one new
  role-boundary test), `team.dto.test.ts` (new).
- `src/whatsapp/` — `whatsapp-webhook.service.ts` (intake after enqueue, in its
  own try/catch), `whatsapp.module.ts` (imports `CrmModule`).
- `src/app.module.ts` — wires `CrmModule`.

### Frontend

- `features/crm/` (new) — `api.ts`, `format.ts`, `crm-view.tsx` (tabs, three
  independent module-gated reads), `pipeline-board.tsx`, `task-list.tsx`,
  `routing-settings.tsx`, `interest-chip.tsx`, `follow-up-strip.tsx`,
  `follow-ups-card.tsx`; `app/(app)/workspace/crm/page.tsx`.
- `features/inbox/` — `api.ts` (stage fields, `interest`/`followUp` filters),
  `conversation-list.tsx` (stage menu incl. the derived Follow-up row, row
  chip, summary, empty state), `message-thread.tsx` (stage chip and follow-up
  strip; `onWritten`), `inbox-view.tsx` (`revision` sequencing of reads and
  writes; `handleWritten`).
- `features/team/` — `api.ts` (`designation`, `personalWhatsApp`,
  `updateMemberProfile`), `member-profile-sheet.tsx` (new), `team-view.tsx`
  (Designation column, owner-only edit, sheet mount),
  `app/(app)/workspace/team/page.tsx`.
- `config/modules.ts`, `config/workspace-nav.ts` — the `crm` key and the Leads
  nav entry.
- `lib/access/api.ts`, `components/workspace/access-provider.tsx` — the
  personal-number eligibility boolean.
- `app/(app)/workspace/page.tsx` — the "Your follow-ups" card.

### Docs

- `Docs/superpowers/specs/2026-11-27-crm-lead-routing-design.md` (approved spec)
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
| `cd Backend; npm test` | 365 tests, 365 pass, 0 fail |
| `cd Backend; npm run typecheck` | exit 0, silent |
| `cd Backend; npx nest build` | exit 0, silent |
| `cd Backend; npx prisma validate` | `The schema at prisma\schema.prisma is valid` |
| `cd frontend; npx tsc --noEmit` | exit 0, silent |
| `cd frontend; npx eslint . --max-warnings=0` | exit 0, silent |
| `cd frontend; npm run build` | exit 0, `/workspace/crm` in the route table |

New suites: `interest.rules`, `round.robin`, `team.dto`, `crm.dto`,
`crm.settings`, `tasks.service`, `crm.pipeline`, `lead.intake`. Extended:
`inbox.queue` (conversation fixture gained the stage fields; stage filter;
two follow-up-filter tests) and `modules` (three role expectations moved, one
new role-boundary test). All backend tests stub Prisma; none needs a database
or a network.

## 4. What is deliberately not here

- No commit or push by me — see the note at the top; the external checkpoint
  did both.
- No `migrate dev`, `db push` or `migrate deploy`.
- No AI call anywhere in the classifier: it is a phrase table, on purpose.
- No CSV export of the board.
- No per-agent routing rules; the spec routes by designation only.
- No email editing in the member sheet (read-only, with the reason).

## Diff summary (verbatim, `git diff --stat 7337b19 HEAD`)

```
 Backend/prisma/migrations/0027_crm_lead_routing/migration.sql |   88 +
 Backend/prisma/schema.prisma                       |   82 +
 Backend/src/app.module.ts                          |    2 +
 Backend/src/crm/crm.controller.ts                  |  108 +
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
 Backend/src/crm/lead.intake.test.ts                |  235 +
 Backend/src/crm/lead.intake.ts                     |  214 +
 Backend/src/crm/round.robin.test.ts                |   34 +
 Backend/src/crm/round.robin.ts                     |   60 +
 Backend/src/crm/tasks.service.test.ts              |  210 +
 Backend/src/crm/tasks.service.ts                   |  287 ++
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
 Backend/src/workspaces/workspaces.service.ts       |  137 +-
 Docs/superpowers/plans/2026-11-27-crm-lead-routing.md | 5089 +++++++++++++++++++++
 Docs/superpowers/specs/2026-11-27-crm-lead-routing-design.md |  459 ++
 frontend/src/app/(app)/workspace/crm/page.tsx      |   48 +
 frontend/src/app/(app)/workspace/page.tsx          |    3 +
 frontend/src/app/(app)/workspace/team/page.tsx     |    2 +-
 frontend/src/components/workspace/access-provider.tsx |    6 +
 frontend/src/config/modules.ts                     |    3 +
 frontend/src/config/workspace-nav.ts               |    8 +
 frontend/src/features/crm/api.ts                   |  142 +
 frontend/src/features/crm/components/crm-view.tsx  |  366 ++
 frontend/src/features/crm/components/follow-up-strip.tsx |  158 +
 frontend/src/features/crm/components/follow-ups-card.tsx |  117 +
 frontend/src/features/crm/components/interest-chip.tsx |  122 +
 frontend/src/features/crm/components/pipeline-board.tsx |  134 +
 frontend/src/features/crm/components/routing-settings.tsx |  166 +
 frontend/src/features/crm/components/task-list.tsx |  181 +
 frontend/src/features/crm/format.ts                |   15 +
 frontend/src/features/inbox/api.ts                 |   18 +
 .../inbox/components/conversation-list.tsx         |   91 +-
 frontend/src/features/inbox/components/inbox-view.tsx |   50 +-
 .../inbox/components/message-thread.tsx            |   24 +
 frontend/src/features/team/api.ts                  |   26 +
 frontend/src/features/team/components/member-profile-sheet.tsx |  210 +
 frontend/src/features/team/components/team-view.tsx |   51 +
 frontend/src/lib/access/api.ts                     |    7 +
 57 files changed, 10198 insertions(+), 28 deletions(-)
```

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

1. Read the diff (or the three commits above) and this report.
2. Apply `0027_crm_lead_routing` with `npx prisma migrate deploy` in the target
   environment, then `npx prisma generate`.
3. Decide whether the pushed commits stay as they are, are squashed, or are
   reverted — that call is yours; I did not touch history.
