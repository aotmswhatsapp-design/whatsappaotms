# Live WhatsApp Inbox — design

Status: approved 2026-11-19. Scope: PRD MODULE 5, WhatsApp channel only.

## Goal

Turn `/workspace/inbox` from a static shell into a working shared inbox: inbound
customer messages are stored, agents read a thread, reply inside the 24-hour
window, attach files, assign the thread, set its status and leave internal notes.

Not in scope: Messenger/Instagram, templates, campaigns, chatbot, analytics,
Redis/BullMQ, agent invitations.

## Decisions taken

| Decision | Choice | Why |
| --- | --- | --- |
| Channel | WhatsApp only | Matches the PRD; no new Meta dashboard work; testable today |
| Tenancy | Workspace-scoped | Assignment and shared queues are meaningless per-user |
| Media | Full inbound and outbound | Chosen by the user |
| Media download | Lazy, on first open | Meta gives the webhook ~20 s; there is no queue |
| Upload cap | 25 MB | WhatsApp allows 100 MB documents; a 100 MB body is not worth it yet |
| Realtime | 3 s polling of the open thread | `EventSource` cannot carry the bearer header |

## Data model (migration `0004_inbox`)

- `Contact` — `(workspaceId, waId)` unique, created by the webhook from
  `value.contacts[]`.
- `Conversation` — `(accountId, contactId)` unique; `status`
  OPEN/PENDING/CLOSED; `assignedToUserId`; `lastInboundAt` (24-hour window);
  `lastMessageAt` and `unreadCount` denormalised for the list.
- `Message` — `wamid` unique (dedupe across Meta retries), direction, kind,
  status QUEUED/SENT/DELIVERED/READ/FAILED, body, media metadata and
  `mediaPath` in Supabase Storage.
- `InternalNote` — separate table so a note can never be sent by accident.

`WhatsAppAccount` gains `workspaceId` (unique) and keeps `userId` as "who
connected it". The migration creates a workspace and OWNER membership for every
existing account before the column becomes NOT NULL.

## Workspace provisioning

`WorkspacesService.primaryFor(claims)` syncs the user row, returns the first
membership, and otherwise creates a workspace with a deterministic slug
(`ws-<user id prefix>`) plus an OWNER membership. It is idempotent under
concurrent calls (unique slug + refetch on conflict).

Every WhatsApp and inbox query uses `workspaceId`; the client never supplies
one.

## Webhook

`delivery()` keeps its signature check and always-200 contract, then hands each
`change.value` to `InboxStore`:

1. route by `metadata.phone_number_id` → account → workspace;
2. upsert contact, upsert message on `wamid`, bump the conversation;
3. move message statuses forward only (a late `sent` never overwrites `read`);
4. store unsupported types as `kind: UNSUPPORTED` so nothing disappears.

## Send and the 24-hour window

Text: `POST /{version}/{phoneNumberId}/messages`. Media: upload to
`/{phoneNumberId}/media` first, then send by id. The row is written as QUEUED
before the call, so a crash leaves evidence. A closed window answers
`409 WINDOW_CLOSED` with readable copy instead of Meta's raw code.

## Media

Private bucket `inbox-media`, path `w/{workspaceId}/{yyyy}/{mm}/{messageId}.{ext}`.
Storage is reached over the Storage REST API with the service key — no SDK
dependency. Inbound bytes are fetched from Meta on first open and cached;
outbound bytes are stored before sending. Reads return a 5-minute signed URL,
so `<img>` needs no auth header. Without a service key the API boots and media
answers 503, matching the existing confirm/resend behaviour.

## API

`/api/v1/inbox`, guard + membership on every route:

`GET /conversations` · `GET /conversations/:id/messages` ·
`POST /conversations/:id/messages` · `POST /conversations/:id/media` ·
`GET /messages/:id/media` · `PATCH /conversations/:id` ·
`POST /conversations/:id/read` · `POST /conversations/:id/notes` ·
`GET /agents` · `GET /summary` · `DELETE /conversations/:id`

`GET /summary` also reports whether a channel exists, which is what the page
uses to show "connect a number" instead of an empty queue.

## UI

`src/features/inbox/`: list with search/status/assignee and unread badges;
thread with day separators, delivery ticks, media previews and amber internal
notes; composer that sends on Enter, attaches files, and is disabled with the
reason printed when the window has closed; a no-channel state linking to
`/workspace/whatsapp`. The page stays a thin server component.

## Privacy

Message content is now stored, which changes the earlier "no message bodies"
promise. Consequences: no bodies in logs, `DELETE /conversations/:id` purges the
thread and its stored media so a deletion request can be honoured, and the
schema comment states the policy.

## Build order

1. Migration, workspace provisioning, channel move (acceptance: the existing
   WhatsApp screen behaves identically).
2. Webhook persistence for text and statuses, with replay tests.
3. Read API + list/thread/notes/assignment/status + polling.
4. Text send with both guards.
5. Media: bucket, lazy inbound fetch, outbound upload.
6. Browser verification at 1440 and 390 with seeded data.
