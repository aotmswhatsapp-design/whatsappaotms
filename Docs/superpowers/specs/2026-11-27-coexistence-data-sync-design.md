# Coexistence data sync — design

Status: awaiting review. Scope: the 24-hour `smb_app_data` obligation, `history` and
`smb_app_state_sync` ingestion, media placeholders, and business-scoped user ids
(BSUID) on `Contact`. Slice A (onboarding, echoes, disconnects) is already
implemented and is not revisited here.

## Goal

A business that onboards its existing WhatsApp Business app number gets its 180
days of chat history and its address book mirrored into the inbox we already
have, and every message that arrives afterwards keeps working — including the
ones Meta sends without a phone number, identified only by a business-scoped
user id.

The customer sees, on the connection screen, whether the sync was requested,
what Meta answered, and — when history was declined in the Business app — the
same fact Meta told us, in one sentence.

## What this is not

Not a second message store: history lands in `messages` and `conversations`, the
same rows, with a flag that says where they came from. Not a background job
system: there is no new queue and no new runner — a history chunk is bounded
work and is written inside Meta's request, batched by thread. Not a merge tool:
two `Contact` rows that turn out to be one person are left alone, with the rule
that decides it stated below. Not a media archiver: media ids are recorded and
the existing lazy download fills bytes when a bubble is opened, exactly as for a
live message. Group chats are not in scope — Meta excludes them from history.

Phases: **B1** sync request + history/contact import (phone-keyed only),
**B2** BSUID identity (phone-optional contacts). B1 is designed so B2 changes one
function and one migration, not the import path.

## The sequence Meta obliges

1. Embedded Signup finishes; the number is already registered, so registration
   is skipped (done in Slice A).
2. Within **24 hours**, `POST /{BUSINESS_PHONE_NUMBER_ID}/smb_app_data` with
   `{ "messaging_product": "whatsapp", "sync_type": "smb_app_state_sync" }`,
   then again with `sync_type: "history"`. Each may be performed **once**; a
   repeat needs the customer to offboard and onboard again.
3. Both answer `{ messaging_product, request_id }`. The response says the
   request was *accepted*, not that history was shared.
4. Webhooks arrive on fields `account_update`, `history`,
   `smb_app_state_sync`, `smb_message_echoes`.
5. Missing the 24 hours is unrecoverable from our side: the customer must
   disconnect in the Business app and onboard again.

`request_id` is stored because Meta's support asks for it. It is not a
correlation key for webhooks — no webhook carries it.

## Decisions taken

| Decision | Choice | Why |
| --- | --- | --- |
| Who triggers the sync | `connectEmbedded`, right after the row is written | The 24-hour clock starts at onboarding; waiting for a screen visit risks the window |
| Sync state | Six nullable columns on `WhatsAppAccount` | The screen has to say requested / done / declined / failed, and support needs the ids. A JSON blob would be unqueryable and untyped |
| "On coexistence" | New `onBizApp` column, written from `is_on_biz_app` | Decides whether `smb_app_data` is legal at all; re-reading Graph on every screen load would be a Meta call per visit |
| Claim semantics | `stateSyncAt` / `historySyncAt` written **after** a successful POST | A failed POST must be retryable; a claimed-but-never-accepted request would look done forever |
| Retry | `POST /v1/whatsapp/connection/sync`, owner only | A transport failure is the customer's problem only if nothing lets them fix it. Meta's own answer covers a repeat; our guard is the timestamp |
| Retry window | Only within 24 h of `lastVerifiedAt` | After that Meta refuses the call; offering a button that cannot work is a lie |
| Reconnect | `ACCOUNT_RECONNECTED` clears all six sync columns | Meta re-grants the synchronisation after offboard/onboard; stale timestamps would suppress a legal sync |
| Firing from a webhook | `void` promise, not awaited, with its own catch | Meta is waiting on that call. A user-initiated connect awaits, because a person is waiting on that one |
| History staging | None — parse and write inside the request | The doc's warning is about naive per-message work. Batched by thread a chunk is ~one statement per contact plus one `createMany`; a staging table would add a runner, a retry policy and a second source of truth for no gain |
| History dedupe | `wamid` unique + `createMany({ skipDuplicates: true })` | Already the delivery dedupe key; a retried chunk converges instead of duplicating |
| Direction of a history message | `from_user_id` present ⇒ INBOUND; else `to` present ⇒ OUTBOUND; else `from === metadata.display_phone_number` ⇒ OUTBOUND; else INBOUND | `from_user_id` is documented as "only included if message is from the user", which is the strongest signal in the payload |
| Imported flag | New `Message.imported` boolean, default false | Needed for the bubble label and for any later retention or purge; echoes stay false because they are live events, not history |
| Unread | Imported rows never increment it | 180 days of history must not arrive as 900 red badges |
| 24-hour window | An imported inbound message moves `lastInboundAt` only if it is under 24 h old **and** the column moves forward | Under-reporting a window costs a template send; over-reporting hands an agent a free-form send Meta will reject |
| Conversation ordering | `updateMany` with `lastMessageAt: { lt: ts }` | Chunks arrive concurrently and out of order; read-then-write loses the newest preview |
| Media placeholder | New `MessageKind.MEDIA_PENDING` | The chunk says "a media message exists" and nothing about its type. Guessing `IMAGE` would be a lie in the thread |
| Media asset | Fill the placeholder by `wamid`; create the row if the asset beat its chunk and the sender is the customer | Assets cover only the last 14 days, so losing one leaves a permanent hole in a recent conversation |
| Contact removals | `action: "remove"` is ignored | The contact may own a conversation; deleting the row would delete the thread |
| `lastSeenAt` from state sync | Not written | A phone-book entry is not a sighting. The column means "last messaged us", and the Contacts screen would misrank a bought list as active |
| Phone-less message (B1) | Counted and skipped, logged with the wamid | A silent drop is a lie about the thread; B2 removes the skip |
| BSUID column (B2) | `Contact.bsuid`, nullable, `@@unique([workspaceId, bsuid])` | `waId` becomes nullable too, and Postgres treats NULLs as distinct, so both uniques coexist without partial indexes |
| Identity resolution (B2) | Resolve by `bsuid` first, then `waId` | Every coexistence payload carries `user_id`; phone-only rows are the legacy case, not the new one |
| Adopting a phone (B2) | A bsuid row adopts a phone only when no other row owns it, or when the owning row has no conversations | Fixes rows created before B2 without merging two live threads |
| Two rows, one person (B2) | Left split, warning logged naming both ids | Merging threads means choosing whose messages win. No honest automatic answer; a manual merge is a separate feature |

## Data model — migration `0028_coexistence_sync`

```prisma
model WhatsAppAccount {
  /// True when Meta reports the number is also in use in the WhatsApp
  /// Business app. `smb_app_data` is legal only for these rows.
  onBizApp             Boolean   @default(false) @map("on_biz_app")
  /// Written only after Meta accepted the request, which is what makes a
  /// retry safe: an unaccepted request leaves these null.
  stateSyncAt          DateTime? @map("state_sync_at")
  stateSyncRequestId   String?   @map("state_sync_request_id")
  historySyncAt        DateTime? @map("history_sync_at")
  historySyncRequestId String?   @map("history_sync_request_id")
  /// Meta reported `progress: 100`, or declined. Null means still arriving.
  historySyncDoneAt    DateTime? @map("history_sync_done_at")
  /// The sentence the connection screen shows: a refusal, a decline, a
  /// transport failure. Cleared when a new request succeeds.
  historySyncError     String?   @map("history_sync_error")
}

model Message {
  /// A row mirrored from the WhatsApp Business app's history. Echoes and live
  /// deliveries stay false: they happened while we were listening.
  imported Boolean @default(false)
}

enum MessageKind {
  // … existing members …
  /// A history row whose chunk carried no contents: the media asset arrives in
  /// a separate webhook, and only for the last 14 days.
  MEDIA_PENDING
}
```

Hand-written SQL, in `Backend/prisma/migrations/0028_coexistence_sync/migration.sql`:

```sql
ALTER TABLE whatsapp_accounts
  ADD COLUMN on_biz_app boolean NOT NULL DEFAULT false,
  ADD COLUMN state_sync_at timestamptz,
  ADD COLUMN state_sync_request_id text,
  ADD COLUMN history_sync_at timestamptz,
  ADD COLUMN history_sync_request_id text,
  ADD COLUMN history_sync_done_at timestamptz,
  ADD COLUMN history_sync_error text;

ALTER TABLE messages
  ADD COLUMN imported boolean NOT NULL DEFAULT false;

ALTER TYPE "MessageKind" ADD VALUE IF NOT EXISTS 'MEDIA_PENDING';
```

`ADD COLUMN … DEFAULT false` is metadata-only in Postgres 11+, so the messages
table is not rewritten. `ADD VALUE` is legal inside a transaction on Postgres 12+
as long as the same transaction does not use the new label — this migration does
not. Verify the enum's real type name against `0004_inbox/migration.sql`; Prisma
emits `"MessageKind"` when the enum has no `@@map`.

No index is added for `imported`: the flag is written and shown per row, never
filtered on at list scale. If a retention purge is ever built it adds its own
partial index.

## Requesting the sync

New `Backend/src/whatsapp/coexistence.starter.ts`:

```ts
export type SyncKind = "smb_app_state_sync" | "history";

@Injectable()
export class CoexistenceStarter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaGraph,
    private readonly box: SecretBox,
  ) {}

  /**
   * Asks Meta for the two synchronisations, in the documented order. Never
   * throws: a connection that succeeded must not be reported as failed because
   * a follow-up call did not.
   */
  async begin(account: {
    id: string;
    phoneNumberId: string;
    graphVersion: string;
    accessTokenCipher: string;
    onBizApp: boolean;
    stateSyncAt: Date | null;
    historySyncAt: Date | null;
  }): Promise<void>
}
```

Rules:

- Return immediately when `!account.onBizApp` — a plain Cloud API number has no
  Business app data, and the call would only produce an error we would have to
  explain away.
- Return immediately when both timestamps are set.
- `smb_app_state_sync` first, then `history`; each is skipped individually when
  its own timestamp is set, so a run interrupted between the two resumes at the
  one that is missing.
- The token is read from `accessTokenCipher` through `SecretBox`, exactly as
  every other Graph call does. An undecryptable token is a recorded error, not a
  crash.
- On success write `{ stateSyncAt: now, stateSyncRequestId }` (or the history
  pair) and clear `historySyncError` when the history call succeeds.
- On failure write `historySyncError` with Meta's `explanation` (or the transport
  reason) and leave the timestamp null, which is what makes the retry legal.

`MetaGraph` gains the one call:

```ts
requestSmbAppData(input: {
  version: string;
  phoneNumberId: string;
  token: string;
  syncType: "smb_app_state_sync" | "history";
}): Promise<{ requestId: string | null }>
```

POST to `/{version}/{phoneNumberId}/smb_app_data`, body
`{ messaging_product: "whatsapp", sync_type }`. A missing `request_id` is
tolerated (null) rather than a shape error: the request may well have been
accepted.

### Where it is called

`connectEmbedded` keeps its existing `values` object and adds
`onBizApp: phone.is_on_biz_app === true`. The sync columns are **not** part of
`values`, so reconnecting the same number does not erase them. After the upsert:

```ts
if (row.onBizApp) {
  await this.coexistence.begin({
    id: row.id,
    phoneNumberId: row.phoneNumberId,
    graphVersion: row.graphVersion,
    accessTokenCipher: row.accessTokenCipher,
    onBizApp: row.onBizApp,
    stateSyncAt: row.stateSyncAt,
    historySyncAt: row.historySyncAt,
  });
}
```

Awaited here, because a person is waiting for the verdict and the two calls take
about as long as the six Graph reads the method already performs.

`applyAccountEvents` in the webhook service gains one branch:

```ts
if (event.event === "ACCOUNT_RECONNECTED") {
  const row = await this.prisma.whatsAppAccount.update({
    where: { id: accountId },
    data: {
      status: "VERIFIED",
      failureReason: null,
      stateSyncAt: null,
      stateSyncRequestId: null,
      historySyncAt: null,
      historySyncRequestId: null,
      historySyncDoneAt: null,
      historySyncError: null,
    },
    select: ACCOUNT_SYNC_SELECT,
  });

  void this.coexistence.begin(row).catch((error) =>
    this.logger.warn(`Could not request the sync for ${row.phoneNumberId}: ${error}`),
  );
}
```

`ACCOUNT_SYNC_SELECT` is a new select constant beside `ACCOUNT_SELECT` holding
only the columns `begin` reads. `WhatsAppWebhookService` gains
`CoexistenceStarter` as a constructor dependency; the module already provides
both.

Not awaited: Meta is waiting on the webhook, and a slow Graph call there becomes
a retried delivery. The flags make the fire-and-forget safe — a duplicate run
finds both timestamps set and returns.

### Retry endpoint

`POST /v1/whatsapp/connection/sync`, `@Roles("OWNER")`, throttled like
`connect`. Reply: `{ sync: CoexistenceSyncView }`. Refusals:

| Condition | Answer |
| --- | --- |
| No account | 400 "Connect a number first." |
| `!onBizApp` | 400 "This number is not used in the WhatsApp Business app, so there is no history to sync." |
| Both requests already accepted | 200 with the current state; nothing is called (not an error — the screen may be retried) |
| More than 24 h since `lastVerifiedAt` | 400 "Meta only accepts this within 24 hours of connecting. The customer has to disconnect and connect again from the WhatsApp Business app." |

## Reading the webhooks

New `Backend/src/whatsapp/coexistence.ts`, pure functions over the parsed JSON,
no Prisma and no Graph, so they are testable against the doc's own examples:

```ts
export interface HistoryThread {
  /** Digits, from `thread.id` or `thread.context.wa_id`. Null when withheld. */
  phone: string | null;
  bsuid: string | null;
  username: string | null;
  messages: HistoryMessage[];
}

export interface HistoryMessage {
  wamid: string;
  direction: "INBOUND" | "OUTBOUND";
  kind: MessageKind;
  status: MessageStatus;
  body: string | null;
  mediaId: string | null;
  mediaMime: string | null;
  mediaSha256: string | null;
  at: Date;
}

export interface MediaAsset {
  wamid: string;
  /** The customer's or the business's number, as the asset payload names it. */
  from: string | null;
  kind: MessageKind;      // resolved from `type`; never MEDIA_PENDING
  mediaId: string | null;
  mediaMime: string | null;
  mediaSha256: string | null;
  caption: string | null;
  at: Date;
}

export interface SyncedContact {
  phone: string | null;
  bsuid: string | null;
  fullName: string | null;
  firstName: string | null;
  action: "add" | "remove";
}

export function historyThreads(payload: unknown): HistoryThread[];
export function historyProgress(payload: unknown): number | null;   // metadata.progress
export function historyDeclined(payload: unknown): string | null;    // 2593109 → sentence
export function mediaAssets(payload: unknown): MediaAsset[];
export function stateSyncContacts(payload: unknown): SyncedContact[];
```

`historyThreads` walks `entry[].changes[]` where `field === "history"`, then
`value.history[].threads[]`. `value.history` may hold several entries in one
change; `metadata` (phase, `chunk_order`, `progress`) sits on each entry, not on
the change, and only `progress` is used. `historyProgress` returns the highest
`progress` across the entries of the delivery, so one entry saying `100`
completes the sync.

Thread phone: `thread.id` when present, else `thread.context.wa_id`. BSUID:
`thread.context.user_id`. Both may be absent at once — such a thread is counted
and skipped in B1, imported in B2.

Per message:

| Field | Source |
| --- | --- |
| `wamid` | `id` — required; a message without one cannot be deduped and is skipped |
| `at` | `timestamp` (Unix seconds, string in payloads) |
| `body` | `text.body`, or the type's `caption` when present |
| `kind` | `type` mapped by the same table `inbox.payload.ts` uses for live messages; `media_placeholder` ⇒ `MEDIA_PENDING` |
| `mediaId` / `mediaMime` / `mediaSha256` | the type object's `id`, `mime_type`, `sha256` — absent on a placeholder |
| `status` | `history_context.status`: `delivered`⇒`DELIVERED`, `read` | `played`⇒`READ`, `sent`⇒`SENT`, `pending`⇒`SENT`, `error`⇒`FAILED` with `errorReason` = "The WhatsApp Business app reported this message as failed." |

`direction` follows the rule in the decisions table. `played` maps to READ
because a voice note that was played was consumed, and the thread's tick has no
"played" state of its own.

### The declined payload has no envelope

Meta's own sample for `2593109` is a bare object —
`{ messaging_product, metadata: { phone_number_id }, history: [ { errors: [...] } ] }`
— with no `entry[].changes[]` wrapper. `phoneNumberIds()` therefore gains a
fallback: when `entry` is absent, read a top-level
`metadata.phone_number_id`. Without it the decline names no number, the delivery
is ignored as unregistered, and the screen waits forever for a sync that was
refused.

`historyDeclined` returns the doc's own title
("History sync is turned off by the business from the WhatsApp Business app"),
not a sentence we invent.

### Media assets

`field: "history"` again, but with `value.messages[]` instead of
`value.history[]`: each carries the real `type`, an `image`/`video`/… object with
`id`, `mime_type`, `sha256`, optional `caption`, and the **same `wamid`** as the
placeholder. Those are the only messages in this feature that can update a row
in place.

## Importing history

New `Backend/src/inbox/history.store.ts`, class `HistoryStore`:

```ts
@Injectable()
export class HistoryStore {
  constructor(private readonly prisma: PrismaService) {}

  /** Writes one chunk. Never throws into the webhook. */
  async import(account: StoreAccount, threads: HistoryThread[]): Promise<{ written: number; skipped: number }>;

  /** Fills or creates a row from a media-asset webhook. */
  async attachMedia(account: StoreAccount, asset: MediaAsset): Promise<void>;

  /** Applies `smb_app_state_sync` entries. */
  async absorbContacts(account: StoreAccount, contacts: SyncedContact[]): Promise<number>;

  /** Meta reported `progress: 100`. */
  async noteComplete(account: StoreAccount): Promise<void>;

  /** The business turned history sharing off; `sentence` is Meta's own title. */
  async noteDeclined(account: StoreAccount, sentence: string): Promise<void>;
}
```

`import`, per thread:

1. Resolve the contact through `contactFor`, which moves out of `InboxStore` into
   `Backend/src/inbox/contact.identity.ts` and is called by both stores — one
   identity rule, not two copies that drift. B1 passes
   `{ phone, bsuid: null }`; a null phone means skip and count.
2. Upsert the conversation on `(accountId, contactId)` with
   `unreadCount: 0` and no `lastInboundAt` on create.
3. `createMany` the messages in batches of 500 with
   `skipDuplicates: true`, every row `imported: true`,
   `createdAt` = the message timestamp, and `status` from the table above.
   Bodies for a `MEDIA_PENDING` row stay null.
4. Update the thread's placement atomically:

```ts
await this.prisma.conversation.updateMany({
  where: { id: conversation.id, lastMessageAt: { lt: newest } },
  data: { lastMessageAt: newest, lastMessagePreview: previewOfNewest },
});
```

5. When the thread's newest **inbound** message is younger than 24 hours, move
   the service window forward by the same atomic pattern:

```ts
await this.prisma.conversation.updateMany({
  where: {
    id: conversation.id,
    OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: newestInbound } }],
  },
  data: { lastInboundAt: newestInbound },
});
```

Nothing else about the thread changes. No `unreadCount`, no `ReplyIntake`, no
`LeadIntake`: imported rows are never returned to the caller, so the two
pipelines cannot see them — the same structural guarantee echoes already have.

`attachMedia`, per asset:

- `updateMany({ where: { wamid, kind: "MEDIA_PENDING" }, data: { kind, mediaId, mediaMime, mediaSha256, body } })`.
- When that matches nothing and `from` is not the business number, create the row
  as an INBOUND message of the asset's real kind, `imported: true`, resolved
  through `contactFor` by `from`. When `from` is the business number, the
  recipient is unknown from the asset alone: log and leave it — the placeholder
  will arrive on its own chunk.
- An asset that matches a row of any other kind is left alone: a live message
  already owns that wamid and has better data.

`absorbContacts`:

- `action === "add"` ⇒ upsert on the identity handles, writing
  `profileName` (`full_name`, else `first_name`) and `phoneDisplay`
  (`phone_number`). Never `lastSeenAt`.
- `action === "remove"` ⇒ ignored, logged.
- No phone ⇒ counted and skipped in B1.

## Wiring into `delivery()`

The parsers run once per delivery, beside `templateStatusEvents(payload)`, and
each account then takes its own rows — the same shape the template statuses
already use:

```ts
const threads = historyThreads(payload);
const syncContacts = stateSyncContacts(payload);
const assets = mediaAssets(payload);
const progress = historyProgress(payload);
const declined = historyDeclined(payload);
```

Inside the per-account loop, after the account events and before the message
path:

```ts
// The same `StoreAccount` literal `store.record` is already given.
const target = { id: account.id, workspaceId: account.workspaceId, phoneNumberId: account.phoneNumberId };

if (declined) await this.history.noteDeclined(target, declined);
else if (progress === 100) await this.history.noteComplete(target);
if (threads.length > 0) await this.history.import(target, threads);
if (syncContacts.length > 0) await this.history.absorbContacts(target, syncContacts);
for (const asset of assets) await this.history.attachMedia(target, asset);
```

`noteDeclined` writes `historySyncDoneAt` and Meta's title into
`historySyncError`; `noteComplete` writes `historySyncDoneAt` only.

Each of those five calls is wrapped in its own `try`/`catch` that logs and
continues: a chunk that fails to write must not stop the message path beneath
it, and must not answer Meta with a 500 for a delivery it will simply retry
into the same failure.

`receivedMessage` narrows. It is `numbers.includes(account.phoneNumberId)`
today, which is true for a `history` change because that payload carries
`metadata.phone_number_id` — so a pure history delivery would log "Signed
delivery stored" and run the inbox path over an empty change list. It becomes
true only when `parseDelivery` produced a change for this number carrying at
least one contact, message, echo or status.

Order matters once: account events are applied before the import, so a number
Meta just reported as disconnected is already marked FAILED when the sync rows
land, and the connection screen never shows a dead number as mid-sync.

## BSUID identity — migration `0029_contact_bsuid`

```prisma
model Contact {
  /// Digits only, exactly as Meta sends `wa_id`. Null when Meta withheld the
  /// number: coexistence payloads identify the person by `bsuid` alone then.
  waId  String? @map("wa_id")
  /// Business-scoped user id (`user_id` / `from_user_id` / `to_user_id`).
  /// Null on rows created before coexistence.
  bsuid String? @map("bsuid")

  @@unique([workspaceId, waId])
  @@unique([workspaceId, bsuid])
}
```

```sql
ALTER TABLE contacts ALTER COLUMN wa_id DROP NOT NULL;
ALTER TABLE contacts ADD COLUMN bsuid text;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_workspace_id_bsuid_key UNIQUE (workspace_id, bsuid);
```

No partial index is needed: Postgres treats NULLs as distinct in a unique index,
so both constraints hold while either column may be null. The existing
`contacts_workspace_id_wa_id_key` stays exactly as it is.

`contactFor` moves out of `InboxStore` into
`Backend/src/inbox/contact.identity.ts` as a free function over `PrismaService`
(it is one rule, not a service), so both stores call the same one:

```ts
export interface ContactRef {
  phone: string | null;
  bsuid: string | null;
}

export function contactFor(
  prisma: PrismaService,
  account: StoreAccount,
  ref: ContactRef,
  profileName: string | null,
  at: Date | null,
): Promise<{ id: string } | null>;
```

`null` is the answer for a message that names no identity at all; the caller
counts and skips it.

Resolution order, with `ref = { phone, bsuid }`:

1. `bsuid` present ⇒ find by `(workspaceId, bsuid)`.
2. Found ⇒ adopt `ref.phone` when the row has none **and** no other row in the
   workspace owns that phone; write the name only when it is non-null; touch
   `lastSeenAt` only when the caller passed an instant. Return.
3. `phone` present ⇒ find by `(workspaceId, waId)`.
4. Both found but different ids ⇒ keep the bsuid row. Adopt the phone only when
   the phone row has **no conversations** (a leftover from a campaign import);
   otherwise leave both rows as they are and log both ids.
5. Neither found ⇒ create with whichever handles exist. Neither handle at all ⇒
   the caller skips that message and counts it.

The two `findUnique` calls are not a `$transaction`: the pooler cannot carry an
interactive one, and a duplicate create is caught by the unique index and
retried once as a read. This is the same converge-on-retry rule the rest of the
store follows.

Live payloads change too: `ParsedMessage.from` becomes
`{ phone: string | null; bsuid: string | null }`, read from `from` + `from_user_id`
(inbound) and `to` + `to_user_id` (echo). `parseDelivery` stops requiring
`from`: a message is kept when it has a wamid, a type, and at least one identity
handle. Without B2 that same message is dropped today, which is a silent hole in
a coexistence inbox regardless of history.

Consequences that must be said on screen:

- A thread whose contact has no number can be read, answered by a human only
  through the Business app, and **cannot be sent to**: Meta addresses a send by
  phone. The composer is disabled with one sentence, the same shape as the
  existing closed-window notice.
- Templates and campaigns are unaffected: their recipients come from a list the
  workspace bought, which always carries a number.
- `phoneDisplay` and every `wa.me` link fall back to the BSUID's tail or to
  nothing; the thread header shows the profile name when there is no number.

## Account lifecycle

- **Offboarded** (`ACCOUNT_OFFBOARDED`, `PARTNER_REMOVED`) — Slice A already
  marks the row FAILED with the reason. The sync columns are left alone: they
  describe what happened, not what is allowed now.
- **Reconnected** — the six sync columns are cleared and both requests are
  re-fired (see above).
- **Deleted by the owner** — the row, its conversations and messages cascade as
  today. Imported rows go with them.

## UI

Connection screen (`/workspace/whatsapp`), a card that renders only when
`account.onBizApp`:

| State | Copy |
| --- | --- |
| `historySyncAt === null`, no error | "Meta has not been asked for the history yet." + action **Start sync** |
| `historySyncAt === null && historySyncError` | "Meta refused the history request: {error}" + **Try again** (only inside 24 h) |
| requested, `historySyncDoneAt === null`, no error | "Meta is sending the history. It arrives in phases covering 180 days; keep the WhatsApp Business app open until it finishes." |
| `historySyncDoneAt` set | "History synchronised." |
| declined (`historySyncError` from 2593109) | "The business turned history sharing off in the WhatsApp Business app. Nothing was imported." + no retry |
| `!onBizApp` | Card absent |

No count is shown: `groupBy` over `messages` with `imported: true` is a full
scan at this table's size, and a number we would have to caveat is worse than no
number.

Inbox: an outbound bubble whose row is `imported` carries a muted label
"WhatsApp Business app" so an agent can tell their own sends from the ones the
business made on their phone. A `MEDIA_PENDING` bubble renders the existing
generic media frame with the label `[media]` and no preview, with one sentence in
the placeholder: "This message's media was not shared."

`MessageView` gains `imported: boolean`; `kindLabel` gains the `MEDIA_PENDING`
case. `MESSAGE_SELECT` gains the column.

## Failure modes

| What happens | What the customer sees | What we do |
| --- | --- | --- |
| `smb_app_data` returns an error | "Meta refused the history request: …" + retry | `historySyncError`, timestamp left null |
| Transport timeout on the request | Same | Same |
| Webhook arrives for an unknown number | Nothing | Logged, ignored (existing rule) |
| Chunk without any phone (B1) | Nothing | Counted, logged per wamid |
| History declined | The sentence from Meta | `historySyncDoneAt` set, `historySyncError` = the title |
| Media asset beats its placeholder | Bubble appears later, with the media | Row created for inbound assets only |
| Nothing ever arrives after 24 h | "Meta is sending the history." forever | Accepted limitation: the copy says history arrives in phases. A support path exists through the stored `request_id` |
| Same delivery retried | Nothing changes | `wamid` unique + `skipDuplicates` |
| Two history chunks race on one thread | Newest preview wins | Atomic `updateMany … lt` |

## Test plan

All tests are `node:test` + `node:assert/strict` against fakes; no live Graph
call, no live database.

| File | Cases |
| --- | --- |
| `Backend/src/whatsapp/coexistence.test.ts` | The doc's approved example: two threads, text + placeholder + inbound reply, direction per message; `media_placeholder` ⇒ `MEDIA_PENDING`; status map for all six `history_context` values; `progress` read from each entry; declined bare payload recognized and its sentence returned; media asset parsed; thread with no phone and no id yields `phone: null`; `state_sync` add/remove shapes |
| `Backend/src/whatsapp/coexistence.starter.test.ts` | Both calls in order with the documented bodies; ids recorded; a second run makes no call; a non-coexistence row makes no call; a failed history call records the error and leaves the timestamp null; a failed state-sync call still attempts history; nothing throws |
| `Backend/src/inbox/history.store.test.ts` | Chunk writes rows `imported: true`, never unread; an old inbound does not open the window; one under 24 h moves it forward; a newer `lastMessageAt` wins and an older chunk cannot reorder; an existing wamid is not duplicated; a phone-less thread is skipped and counted (B1); media asset fills a placeholder; inbound asset with no row creates one; asset matching a live row leaves it alone; contact removal ignored; `lastSeenAt` untouched |
| `Backend/src/inbox/contact.identity.test.ts` (B2) | bsuid found ⇒ returns it; phone-less contact created; phone adopted when free; not adopted when another row owns it with conversations; adopted when that row has none; both-missing ⇒ skipped |
| `Backend/src/whatsapp/whatsapp-webhook.sync.test.ts` | A `history` change reaches `HistoryStore` and the account's `lastEventAt`; a `state_sync` change reaches `absorbContacts`; neither enqueues an agent run nor a lead classification; the bare declined payload is matched to its account |
| `Backend/src/whatsapp/whatsapp.service.embedded.test.ts` (extend) | `onBizApp` recorded from `is_on_biz_app`; sync fired only when true; `values` never clears the sync columns |

Gates before the slice is reported done: `npm test`, `npm run typecheck`,
`npx nest build` in `Backend/`; `npx tsc --noEmit`, `npx eslint . --max-warnings=0`,
`npm run build` in `frontend/`.

## Operator steps (not code)

In the Meta App Dashboard, subscribe the app to four webhook fields before
testing: `account_update`, `history`, `smb_app_state_sync`, `smb_message_echoes`.
Without them `connectEmbedded` succeeds and every sync call is accepted, and
nothing ever arrives — the failure looks exactly like a Meta outage.

## Out of scope

- Group chats (Meta excludes them from history).
- Re-downloading media bytes for imported messages beyond the existing lazy
  download on open.
- Merging two contact rows that turn out to be one person.
- Retention or purge of imported rows.
- Edit and revoke events in history (the live `edit`/`revoke` webhooks are
  already handled by the messages parser).
- Sending to a contact with no phone number.

## Phases

1. **B1** — migration 0028, `MetaGraph.requestSmbAppData`, `CoexistenceStarter`,
   `coexistence.ts` parsers, `HistoryStore` (phone-keyed, media, contacts),
   webhook wiring, retry endpoint, connection card, `MEDIA_PENDING` and
   `imported` in the inbox view.
2. **B2** — migration 0029, nullable `waId` + `bsuid`, `contactFor` resolution
   order, live payload identity handles, composer refusal on a phone-less
   thread, removal of the B1 skip counters.

Each phase is independently shippable: B1 loses only the messages of customers
who have no phone number in Meta's payload, and says so in the log.
