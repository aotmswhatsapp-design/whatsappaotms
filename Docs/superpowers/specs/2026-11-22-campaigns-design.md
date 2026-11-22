# Campaigns — design

Status: approved 2026-11-22. Scope: AOTMS campaigns sent through the WhatsApp
Cloud API, WhatsApp channel only.

## Goal

A workspace picks one approved template, a tag-defined audience and a time, and
this API sends that template to every matched contact through their own Inbox
conversation. Delivery and read figures come from the status events the webhook
already stores, so a campaign's insights are the same numbers an agent sees in a
thread.

## What this is not

Meta's "Messaging campaigns in Meta Business Suite" is a no-code tool with **no
API** — the documentation states it plainly: there is no call to make. Three
consequences, and this module must not pretend otherwise:

1. AOTMS cannot create, read, pause or report on a Business Suite campaign.
2. Billing is out of reach. Those campaigns charge an auto-created ad account
   (marketing) or the Messaging account (event-based); a Tech Provider's token
   cannot read either. The UI therefore shows **no money at all**, and says the
   charge is Meta's, per delivered message.
3. That tool's behaviours are not platform rules. Its 9 AM–5 PM recipient-local
   delivery window, and its "event-based campaigns cannot be edited once
   published" rule, belong to the beta tool. A schedule here is in the
   workspace's clock and is stated as such; event-based campaigns are not built
   because Meta's own event path runs through Zapier, which is not a Cloud API
   concept.

Also not in scope: opt-out handling (Meta requires opt-in, not a STOP list, and
we collect no unsubscribe signal), phone-number messaging-limit tiers, A/B
variants, recurring schedules, video or document template headers.

## Decisions taken

| Decision | Choice | Why |
| --- | --- | --- |
| Where a send lands | The recipient's Inbox conversation + a `TEMPLATE` message | Replies arrive where agents work, and the status webhook already updates those rows |
| Delivery truth | `Message.status` / `deliveredAt` / `readAt` | One writer, one source; no counters to drift |
| Recipient status | `PENDING · SENT · FAILED · SKIPPED` only | Delivery is the message's business |
| Audience | `Contact.tags` (any-of), empty means everyone | The only segmentation primitive that exists |
| Audience snapshot | Materialised at start, not at create | The list that gets messages is the list that matched when sending began |
| Engine | In-process interval, database as the queue | Neither BullMQ nor Redis exists in this service; adding Redis is separate infrastructure |
| Claiming | One conditional `UPDATE … WHERE status = 'SCHEDULED' AND scheduledAt <= now()` | Two loops can never send the same campaign twice |
| Pacing | 5 sends/second, configurable | Conservative for a single Render instance against a default 80 msg/s number |
| Token binding | Fixed value, or `contact.name` (required fallback) / `contact.waId` | The greeting is the only per-recipient substitution a v1 needs |
| Marketing opt-in | Checkbox required at create for `MARKETING` templates, stored as `optInConfirmed` | Meta's policy is opt-in; recording the acknowledgement is the honest minimum |
| Editing | Drafts only; a started campaign can only pause, resume or cancel | Mirrors the published-campaign rule without pretending to be that tool |
| Size cap | 10,000 recipients per campaign | Bounded run time on one process; a clear error beats a silent half-send |

## Data model — migration `0011_campaigns`

```
enum CampaignStatus { DRAFT SCHEDULED RUNNING PAUSED COMPLETED CANCELLED }
enum RecipientStatus { PENDING SENT FAILED SKIPPED }

model Campaign {
  id, workspaceId, name
  status CampaignStatus @default(DRAFT)
  templateId, templateName, templateLanguage, templateCategory   // snapshot at create
  audienceTags String[]
  variables Json            // token -> { kind: "static", value } | { kind: "contact", field, fallback? }
  buttonUrls Json           // button index -> address, when the approved URL ends in a variable
  optInConfirmed Boolean @default(false)
  scheduledAt, startedAt, completedAt, pausedAt
  totalCount, sentCount, failedCount, skippedCount   // written only by the runner
  createdByUserId
  timestamps
}

model CampaignRecipient {
  id, campaignId, contactId, waId
  status RecipientStatus @default(PENDING)
  messageId String? @unique
  errorReason String?
  attempts Int @default(0)
  claimedAt DateTime?
  timestamps
  @@unique([campaignId, contactId])
  @@index([campaignId, status])
}

model Message {
  … existing columns …
  campaignId String? @index     // set by the runner; null for every other send
}
```

`templateCategory` is copied from `MessageTemplate.category`, which is how the
campaign's own type is displayed: a `MARKETING` template is a marketing
campaign, a `UTILITY` one is a utility campaign. Nothing is inferred.

## Sending

`CampaignsRunner` runs every 5 s and does three things.

**Claim.** One statement moves due campaigns to `RUNNING`:

```sql
UPDATE campaigns SET status = 'RUNNING', started_at = now()
WHERE id = $1 AND status = 'SCHEDULED' AND scheduled_at <= now()
```

A zero row count means another iteration already has it. Starting by hand
(`POST /start`) performs the same transition, then the runner picks it up.

**Materialise.** If `totalCount = 0`, insert one `CampaignRecipient` per matching
contact with `createMany … skipDuplicates: true`, and set `totalCount`. One
statement, which the Supabase transaction pooler accepts. An empty result
completes the campaign immediately as `COMPLETED` with zero counts.

**Batch.** Take 10 `PENDING` rows, and for each:

1. Resolve the token map: fixed values pass through, `contact.name` uses
   `profileName` or its stored fallback, `contact.waId` uses the digits.
2. Find or create the `Conversation` for that contact on the workspace's single
   account (`workspaceId` is unique on `WhatsAppAccount`).
3. Call `InboxSender.template(...)` with `campaignId`, the same call the Inbox
   composer makes, so the row, the wamid, `sentAt` and the queue preview all
   behave identically.
4. Mark the recipient `SENT` with the message id, or `FAILED` with Meta's
   message, and increment `sentCount` / `failedCount`.

Then wait `1000 / CAMPAIGN_SEND_PER_SECOND` ms and continue. When no `PENDING`
row remains, set `COMPLETED` and `completedAt`.

**Restart safety.** A recipient claimed more than 60 s ago is returned to
`PENDING` by the next claim, and `attempts` is incremented with a cap of 3, so a
process that dies mid-batch resumes rather than stalling or looping forever.

**Failure policy.** One recipient's Graph error never aborts the campaign. A
missing or disconnected number fails the run (`NO_CHANNEL`), and every
`PENDING` recipient becomes `SKIPPED`.

**Pause and resume.** `PAUSED` simply stops the claim; `resume` returns a paused
campaign to `RUNNING`. `cancel` marks the campaign `CANCELLED` and the remaining
`PENDING` rows `SKIPPED`.

## API — `Backend/src/campaigns/`

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/campaigns` | List with status filter, newest first, counts included |
| `POST` | `/campaigns` | Create a draft: name, templateId, audienceTags, variables, buttonUrls, scheduledAt, optInConfirmed |
| `GET` | `/campaigns/options` | Approved templates with parsed shape, the workspace's tags, channel state |
| `GET` | `/campaigns/audience?tags=` | Matched contact count and five sample names, for the live count |
| `GET` | `/campaigns/:id` | Campaign, insights buckets, first page of recipients |
| `PATCH` | `/campaigns/:id` | Draft only: name, audience, variables, schedule |
| `POST` | `/campaigns/:id/start` | Draft or scheduled → running now |
| `POST` | `/campaigns/:id/pause` · `/resume` · `/cancel` | Running only |
| `POST` | `/campaigns/:id/test` | One template send to a typed number or a chosen contact, no recipient row |
| `GET` | `/campaigns/:id/recipients.csv` | `wa_id, name, status, error, sent_at, delivered_at, read_at` |
| `DELETE` | `/campaigns/:id` | Drafts only |

Machine-readable codes, matching the inbox's `409 WINDOW_CLOSED` style:
`TEMPLATE_NOT_APPROVED`, `TEMPLATE_VARIABLES_INVALID` (the existing list from
`template-send.ts`), `AUDIENCE_EMPTY`, `AUDIENCE_TOO_LARGE`, `NO_CHANNEL`,
`OPT_IN_REQUIRED`, `CAMPAIGN_LOCKED`, `CAMPAIGN_EMPTY`.

Insights in `GET /campaigns/:id` are two aggregations, not counters:

```ts
Message.groupBy({ by: ["status"], where: { campaignId } })        // QUEUED SENT DELIVERED READ FAILED
CampaignRecipient.groupBy({ by: ["status"], where: { campaignId } }) // pending / skipped
```

## Screens

**`/workspace/campaigns`** — the existing placeholder becomes real: a status
filter, a `DataTable` of name, template and its category, audience, status,
sent/delivered/read and schedule, and a New campaign panel. The panel walks
name → template → audience (with the live matched count) → values → schedule →
review, and refuses to submit a marketing campaign without the opt-in
acknowledgement.

**`/workspace/campaigns/[id]`** — status and the actions the status allows, a
progress bar, the insights strip (Total, Sent, Delivered, Read, Failed), one line
saying cost is Meta's per delivered message and is not shown here, the
recipients table with each failure's reason, the CSV export, and 3 s polling
while the campaign is running — the same pattern the Inbox thread uses.

Both live in `src/features/campaigns/` and are reached through thin server pages
that pass only ids, like the Templates routes. `TemplatePreview` is not shared
across features (the layering rule forbids it); the campaign form renders its own
compact bubble from a shape, and the pure token parser moves from
`features/inbox/template-shape.ts` to `src/lib/templates/shape.ts` so both
features read one implementation.

## Verification

- Backend `npx tsc --noEmit` and `npm run build`; frontend `npx tsc --noEmit`,
  `npx eslint src --max-warnings=0`, `npm run build`; the new routes present in
  `Backend/dist`.
- Engine exercised against a two-contact workspace: create → start → recipients
  reach `SENT` or `FAILED` with reasons → counters agree with
  `Message.groupBy`, → pause halts, → resume finishes, → a second `start`
  returns `CAMPAIGN_LOCKED`.
- Browser pass at 1440 and 390 on a throwaway fixture route that is deleted
  afterwards, as used for the Inbox.
- Not verified in this pass: a real send to a live number, and the CSV download
  in a real browser session (no seeded credentials).

## Known gaps

No opt-out list, no per-number messaging-tier check before sending, no
retry-after-failure action for individual recipients, and no campaign filter in
the Inbox queue — a large campaign adds one thread per recipient there, which is
what the Inbox is for.
