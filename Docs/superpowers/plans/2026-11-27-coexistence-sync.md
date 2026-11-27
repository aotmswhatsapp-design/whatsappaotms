# Coexistence data sync (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a number that stays usable in the WhatsApp Business app bring its address book and 180 days of history into our inbox, and let the owner see — and retry — the two requests Meta allows only once in the first 24 hours.

**Architecture:** Two pure parser modules reduce Meta's `history` and `smb_app_state_sync` payloads to rows; `HistoryStore` writes them with the same `wamid`-dedupe, atomic-ordering rules the live delivery path already uses; `CoexistenceStarter` makes the two `smb_app_data` calls and records what Meta answered. Nothing new runs in the background: a history chunk is written inside Meta's own webhook request.

**Tech Stack:** NestJS 11, Prisma 6 against Supabase Postgres (pooler, so no interactive `$transaction`), `node:test` + `node:assert/strict`, Next.js 16 App Router.

**Spec:** `Docs/superpowers/specs/2026-11-27-coexistence-data-sync-design.md` — B1 of its two phases. Read it before task 1; where this plan and the spec disagree, this plan's "Rulings taken while planning" section is authoritative and says why.

## Global Constraints

- Backend: `npm test`, `npm run typecheck`, `npx nest build` in `Backend/`. Frontend: `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `npm run build` in `frontend/`.
- **Do not commit, do not push, do not deploy.** Every task ends with a verification step, never a `git commit`. The owner commits when the whole slice reads right.
- Migrations are hand-written SQL applied with `prisma migrate deploy`. Never `prisma migrate dev`, never `prisma db push`.
- The runtime URL goes through Supabase's transaction pooler: no interactive `$transaction` anywhere. Every write is individually idempotent instead.
- No cross-workspace leakage: every query is scoped by `workspaceId`, directly or through a row that carries it.
- PowerShell: `;` separates commands, never `&&`.
- Tests are `node:test` + `node:assert/strict` with hand-written fakes cast `as unknown as PrismaService`. No live database, no live Graph.
- Comments explain *why*. No comment restates what the code says.
- Every Graph call goes through `MetaGraph`; no `fetch` in a service.
- Names are camelCase in TypeScript and snake_case in SQL.

## Rulings taken while planning

The spec's behaviour stands. These are the places where writing the code showed the spec's own prose needed a decision, and what was decided:

| # | Ruling | Why |
| --- | --- | --- |
| 1 | `HistoryThread`, `MediaAsset`, `SyncedContact`, progress and decline rows each carry `phoneNumberId` | The parsers run once per delivery, and a delivery can name several numbers. Without the number, account A's chunk would be imported into account B — a cross-workspace write. The spec's interfaces omitted it; its rule ("each account takes its own rows") requires it. |
| 2 | `HistoryMessage` also carries `errorReason` | The spec maps `history_context.status: "error"` to `FAILED` *with* a reason, and the interface had nowhere to put it. |
| 3 | `historyDeclined` returns an array of `{ phoneNumberId, sentence }` | Same multi-number reason; it also keeps the wiring shape identical to the other four parsers. |
| 4 | `contactFor` in B1 is phone-only; `ref.bsuid` is accepted and ignored | `Contact.bsuid` does not exist until migration 0029, so resolving by it would not compile. B2 fills in the branch; the call sites do not change. |
| 5 | A history message with no usable `timestamp` is skipped, not dated | `new Date()` would make 180-day-old history look like it arrived now and could open the service window; epoch 0 would render as 1970. |
| 6 | `attachMedia` decides "sender is the business" by comparing digits of `from` with the account's `displayPhoneNumber` | `StoreAccount.phoneNumberId` is Meta's numeric id, not a phone number; comparing the two would never match. `displayPhoneNumber` is already stored on the row. |
| 7 | `ACCOUNT_RECONNECTED` also stamps `lastVerifiedAt`/`lastCheckAt` | The 24-hour window is measured from `lastVerifiedAt`. Clearing the sync columns without moving that stamp would leave a freshly re-granted sync refused by our own guard. |
| 8 | `historySyncError` is shared by both requests; the copy says "Meta refused the sync request: …" | One error column was the spec's decision. Naming only "history" would mislabel a state-sync failure. A successful history call clears the column, so a stale state-sync error never outlives the run. |
| 9 | The connection card's state is computed from the three stamps, not read as text | `historySyncAt` is written *after* acceptance, so "requested but not done" is a real state that has to be named; the spec's table did not cover "requested, error set, not done". |
| 10 | `MEDIA_PENDING` stays out of `MEDIA_KINDS` | It carries no file and no id. Treating it as media would make the bubble claim a file exists and is gone. It renders through the label path instead. |

---

### Task 1: Migration `0028_coexistence_sync` and the schema behind it

**Files:**
- Create: `Backend/prisma/migrations/0028_coexistence_sync/migration.sql`
- Modify: `Backend/prisma/schema.prisma` (models `WhatsAppAccount`, `Message`; enum `MessageKind`)

**Interfaces:**
- Consumes: nothing.
- Produces: `WhatsAppAccount.onBizApp/stateSyncAt/stateSyncRequestId/historySyncAt/historySyncRequestId/historySyncDoneAt/historySyncError`, `Message.imported`, `MessageKind.MEDIA_PENDING` — every later task reads these names.

- [ ] **Step 1: Write the migration**

`Backend/prisma/migrations/0028_coexistence_sync/migration.sql`:

```sql
-- The 24-hour coexistence obligation: what Meta was asked for, what it
-- answered, and whether the history has finished arriving.
--
-- Hand-written because this repository authors migrations as SQL and applies
-- them with `prisma migrate deploy` (never `migrate dev` or `db push`).
--
-- `ADD COLUMN ... DEFAULT false` is metadata-only on Postgres 11+, so the
-- messages table is not rewritten. `ADD VALUE` is legal inside the transaction
-- `migrate deploy` opens on Postgres 12+ as long as that transaction does not
-- use the new label; this one does not.

ALTER TABLE "whatsapp_accounts"
    ADD COLUMN "on_biz_app" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "state_sync_at" TIMESTAMP(3),
    ADD COLUMN "state_sync_request_id" TEXT,
    ADD COLUMN "history_sync_at" TIMESTAMP(3),
    ADD COLUMN "history_sync_request_id" TEXT,
    ADD COLUMN "history_sync_done_at" TIMESTAMP(3),
    ADD COLUMN "history_sync_error" TEXT;

ALTER TABLE "messages"
    ADD COLUMN "imported" BOOLEAN NOT NULL DEFAULT false;

ALTER TYPE "MessageKind" ADD VALUE IF NOT EXISTS 'MEDIA_PENDING';
```

- [ ] **Step 2: Add the columns to the schema**

In `model WhatsAppAccount`, immediately after the `insightsEnabledAt` field and before `tokenExpiresAt`:

```prisma
  /// True when Meta reports the number is also in use in the WhatsApp
  /// Business app. `smb_app_data` is legal only for these rows, so this
  /// decides whether the two sync calls are attempted at all.
  onBizApp             Boolean   @default(false) @map("on_biz_app")
  /// Written only after Meta accepted the request, which is what makes a
  /// retry safe: an unaccepted request leaves these null.
  stateSyncAt          DateTime? @map("state_sync_at")
  stateSyncRequestId   String?   @map("state_sync_request_id")
  historySyncAt        DateTime? @map("history_sync_at")
  historySyncRequestId String?   @map("history_sync_request_id")
  /// Meta reported `progress: 100`, or declined the sync. Null means the
  /// history is still arriving or was never asked for.
  historySyncDoneAt    DateTime? @map("history_sync_done_at")
  /// The sentence the connection screen shows: a refusal, a decline, a dead
  /// token. Cleared when a new history request succeeds.
  historySyncError     String?   @map("history_sync_error")
```

In `model Message`, after `payload` and before `campaignId`:

```prisma
  /// A row mirrored from the WhatsApp Business app's history. Echoes and live
  /// deliveries stay false: those happened while we were listening.
  imported       Boolean          @default(false)
```

In `enum MessageKind`, after `UNSUPPORTED`:

```prisma
  /// A history row whose chunk carried no contents: the media asset arrives in
  /// a separate webhook, and only for the last 14 days.
  MEDIA_PENDING
```

- [ ] **Step 3: Validate and regenerate the client**

Run in `Backend/`:

```powershell
npx prisma validate
npx prisma generate
```

Expected: `The schema at prisma\schema.prisma is valid` and `Generated Prisma Client`.

- [ ] **Step 4: Verify the schema still typechecks**

Run: `npm run typecheck`
Expected: PASS. Nothing references the new fields yet, so this only proves the generated client and the schema agree.

---

### Task 2: `MetaGraph.requestSmbAppData`

**Files:**
- Modify: `Backend/src/whatsapp/meta-graph.ts` (add the method directly after `subscribeApp`)
- Test: `Backend/src/whatsapp/meta-graph.sync.test.ts` (new)

**Interfaces:**
- Consumes: `this.urlOf(version, segments)` and `this.send<T>(url, { method, token, body })`, both private to `MetaGraph` and already used by `createQrCode`.
- Produces: `requestSmbAppData(input: { version: string; phoneNumberId: string; token: string; syncType: "smb_app_state_sync" | "history" }): Promise<{ requestId: string | null }>` — Task 6 calls it.

- [ ] **Step 1: Write the failing test**

`Backend/src/whatsapp/meta-graph.sync.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { ConfigService } from "@nestjs/config";

import { MetaGraph } from "./meta-graph";

/**
 * The sync request is a single POST whose path and body Meta documents
 * exactly, and which may be performed only once. A wrong path is a silent
 * no-op against the wrong object, so both are read here rather than trusted.
 */

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function graph() {
  const config = {
    get: (key: string) =>
      key === "META_GRAPH_BASE_URL" ? "https://graph.test" : undefined,
  } as unknown as ConfigService;

  return new MetaGraph(config);
}

function answer(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];

  globalThis.fetch = (async (url: string | URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return calls;
}

test("the sync request is one POST with the documented body", async () => {
  const calls = answer({ messaging_product: "whatsapp", request_id: "req-1" });

  const result = await graph().requestSmbAppData({
    version: "v23.0",
    phoneNumberId: "109800000000000",
    token: "tok-1",
    syncType: "history",
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://graph.test/v23.0/109800000000000/smb_app_data",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    (calls[0].init.headers as Record<string, string>).authorization,
    "Bearer tok-1",
  );
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    messaging_product: "whatsapp",
    sync_type: "history",
  });
  assert.deepEqual(result, { requestId: "req-1" });
});

test("a reply without a request id is still an accepted request", async () => {
  answer({ messaging_product: "whatsapp" });

  const result = await graph().requestSmbAppData({
    version: "v23.0",
    phoneNumberId: "109800000000000",
    token: "tok-1",
    syncType: "smb_app_state_sync",
  });

  // Refusing to record it would send the caller back to Meta, which allows
  // each kind once — the second attempt is the one that fails.
  assert.deepEqual(result, { requestId: null });
});
```

- [ ] **Step 2: Run it to see it fail**

Run in `Backend/`: `npm test`
Expected: FAIL to compile — `Property 'requestSmbAppData' does not exist on type 'MetaGraph'`.

- [ ] **Step 3: Add the method**

In `Backend/src/whatsapp/meta-graph.ts`, immediately after the `subscribeApp` method:

```ts
  /**
   * Asks Meta to share what the WhatsApp Business app already holds: the
   * address book (`smb_app_state_sync`) and 180 days of conversations
   * (`history`).
   *
   * Legal once per kind and only within 24 hours of onboarding, which is why
   * the caller stores the `request_id` rather than repeating the call. The
   * answer says the request was accepted, not that any history was shared.
   */
  async requestSmbAppData(input: {
    version: string;
    phoneNumberId: string;
    token: string;
    syncType: "smb_app_state_sync" | "history";
  }): Promise<{ requestId: string | null }> {
    const answer = await this.send<{ request_id?: string }>(
      this.urlOf(input.version, [input.phoneNumberId, "smb_app_data"]),
      {
        method: "POST",
        token: input.token,
        body: { messaging_product: "whatsapp", sync_type: input.syncType },
      },
    );

    // A missing id is tolerated rather than a shape error: the request may
    // well have been accepted, and a caller that treats this as a failure
    // would ask again — which Meta does not allow.
    return { requestId: textOf(answer.request_id) };
  }
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, including the two new tests.

---

### Task 3: The parsers — `coexistence.ts`

**Files:**
- Modify: `Backend/src/inbox/inbox.payload.ts` (export `kindOf`, add the `media_placeholder` case)
- Create: `Backend/src/whatsapp/coexistence.ts`
- Test: `Backend/src/whatsapp/coexistence.test.ts` (new)

**Interfaces:**
- Consumes: `kindOf(type: string): MessageKind` from `../inbox/inbox.payload`; `MessageKind`, `MessageStatus` from `@prisma/client`.
- Produces, all imported by Task 7:
  - `historyThreads(payload: unknown): HistoryThread[]`
  - `historyProgress(payload: unknown): SyncProgress[]`
  - `historyDeclined(payload: unknown): DeclinedSync[]`
  - `mediaAssets(payload: unknown): MediaAsset[]`
  - `stateSyncContacts(payload: unknown): SyncedContact[]`

- [ ] **Step 1: Export the kind table and teach it the placeholder**

In `Backend/src/inbox/inbox.payload.ts`, change `function kindOf` to `export function kindOf` and add the case:

```ts
export function kindOf(type: string): MessageKind {
  switch (type) {
    case "text":
      return "TEXT";
    case "location":
      return "LOCATION";
    case "contacts":
      return "CONTACTS";
    case "button":
      return "BUTTON";
    case "interactive":
      return "INTERACTIVE";
    case "reaction":
      return "REACTION";
    // A history chunk says a media message exists and nothing about its type;
    // the asset arrives in its own webhook. Guessing IMAGE here would be a lie
    // in the thread until that asset lands.
    case "media_placeholder":
      return "MEDIA_PENDING";
    default:
      return MEDIA[type] ?? "UNSUPPORTED";
  }
}
```

Leave the `MEDIA` record unchanged: `media_placeholder` must not become a media kind, because `parseMessage` uses `MEDIA[type]` to decide whether the payload carries contents.

- [ ] **Step 2: Write the parser**

`Backend/src/whatsapp/coexistence.ts`:

```ts
import type { MessageKind, MessageStatus } from "@prisma/client";

import { kindOf } from "../inbox/inbox.payload";

/**
 * Meta's coexistence payloads, reduced to the shapes the inbox imports.
 *
 * Pure functions over parsed JSON, with no Prisma and no Graph, so every rule
 * can be checked against Meta's own samples. This is the part of the feature
 * where a wrong assumption is silent: a message read as inbound answers
 * itself, and a thread keyed on the wrong number lands in the wrong workspace.
 */

export interface HistoryMessage {
  wamid: string;
  direction: "INBOUND" | "OUTBOUND";
  kind: MessageKind;
  status: MessageStatus;
  body: string | null;
  mediaId: string | null;
  mediaMime: string | null;
  mediaSha256: string | null;
  errorReason: string | null;
  at: Date;
}

export interface HistoryThread {
  /** The number that received this history, so a delivery can name several. */
  phoneNumberId: string;
  /** Digits, from `thread.id` or `thread.context.wa_id`. Null when withheld. */
  phone: string | null;
  bsuid: string | null;
  username: string | null;
  messages: HistoryMessage[];
}

export interface MediaAsset {
  phoneNumberId: string;
  wamid: string;
  /** The sender's number. The business's own number marks an echo asset. */
  from: string | null;
  /** Resolved from `type`; never MEDIA_PENDING and never UNSUPPORTED. */
  kind: MessageKind;
  mediaId: string | null;
  mediaMime: string | null;
  mediaSha256: string | null;
  caption: string | null;
  at: Date;
}

export interface SyncedContact {
  phoneNumberId: string;
  phone: string | null;
  bsuid: string | null;
  fullName: string | null;
  firstName: string | null;
  action: "add" | "remove";
}

/** The highest `progress` an entry in this delivery reported for one number. */
export interface SyncProgress {
  phoneNumberId: string;
  progress: number;
}

export interface DeclinedSync {
  phoneNumberId: string;
  /** Meta's own title, not a sentence we invent. */
  sentence: string;
}

const MEDIA_KINDS: ReadonlySet<MessageKind> = new Set<MessageKind>([
  "IMAGE",
  "DOCUMENT",
  "AUDIO",
  "VIDEO",
  "STICKER",
]);

/** `history_context.status` → our delivery state. */
const HISTORY_STATUS: Record<string, MessageStatus> = {
  delivered: "DELIVERED",
  // A voice note that was played was consumed; the thread's tick has no
  // "played" state of its own.
  played: "READ",
  read: "READ",
  sent: "SENT",
  pending: "SENT",
  error: "FAILED",
};

/** Meta's code for "history sync is turned off in the WhatsApp Business app". */
const DECLINED_CODE = 2593109;

const DECLINED_TITLE =
  "History sync is turned off by the business from the WhatsApp Business app";

/** The failure sentence the thread shows for a message Meta marked failed. */
const HISTORY_FAILED =
  "The WhatsApp Business app reported this message as failed.";

type Json = Record<string, unknown>;

function objectAt(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function stringAt(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberAt(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function digits(value: string | null): string | null {
  return value ? value.replace(/\D/g, "") || null : null;
}

/** Every `entry[].changes[]` item, with its `field`, and nothing filtered. */
function changesOf(payload: unknown): { field: string | null; value: Json }[] {
  const root = objectAt(payload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];
  const found: { field: string | null; value: Json }[] = [];

  for (const entry of entries) {
    const entryObject = objectAt(entry);
    const changes = Array.isArray(entryObject?.changes)
      ? entryObject.changes
      : [];

    for (const change of changes) {
      const changeObject = objectAt(change);
      const value = objectAt(changeObject?.value);

      if (value) found.push({ field: stringAt(changeObject?.field), value });
    }
  }

  return found;
}

function phoneNumberOf(value: Json): string | null {
  return stringAt(objectAt(value.metadata)?.phone_number_id);
}

/** Seconds since the epoch as a payload string, or null when it makes no sense. */
function instantOf(value: unknown): Date | null {
  const seconds = numberAt(value);

  // An unusable timestamp cannot be placed in a 180-day history: dating it
  // "now" would sort it to the top and could open the service window.
  return seconds !== null && seconds > 0 ? new Date(seconds * 1000) : null;
}

export function historyThreads(payload: unknown): HistoryThread[] {
  const threads: HistoryThread[] = [];

  for (const change of changesOf(payload)) {
    const phoneNumberId = phoneNumberOf(change.value);
    if (!phoneNumberId) continue;

    const business = digits(
      stringAt(objectAt(change.value.metadata)?.display_phone_number),
    );
    const entries = Array.isArray(change.value.history)
      ? change.value.history
      : [];

    for (const entry of entries) {
      const entryObject = objectAt(entry);
      const rows = Array.isArray(entryObject?.threads) ? entryObject.threads : [];

      for (const row of rows) {
        const thread = objectAt(row);
        if (!thread) continue;

        const context = objectAt(thread.context);
        const messages = Array.isArray(thread.messages) ? thread.messages : [];
        const parsed = messages
          .map((message) => historyMessageOf(message, business))
          .filter((message): message is HistoryMessage => message !== null);

        threads.push({
          phoneNumberId,
          phone: stringAt(thread.id) ?? stringAt(context?.wa_id),
          bsuid: stringAt(context?.user_id),
          username: stringAt(context?.username),
          messages: parsed,
        });
      }
    }
  }

  return threads;
}

function historyMessageOf(
  input: unknown,
  business: string | null,
): HistoryMessage | null {
  const message = objectAt(input);
  const wamid = stringAt(message?.id);
  const type = stringAt(message?.type);
  const at = instantOf(message?.timestamp);

  // A message without an id cannot be deduped, and one without a timestamp
  // cannot be placed: both would be a row we could never correct.
  if (!message || !wamid || !type || !at) return null;

  const kind = kindOf(type);
  // A placeholder names no contents; asking for `message[type]` would look up
  // a key Meta does not send.
  const content = kind === "MEDIA_PENDING" ? null : objectAt(message[type]);
  const direction = directionOf(message, business);
  const reported = stringAt(objectAt(message.history_context)?.status);
  const status =
    (reported ? HISTORY_STATUS[reported] : undefined) ??
    (direction === "INBOUND" ? "DELIVERED" : "SENT");

  return {
    wamid,
    direction,
    kind,
    status,
    body:
      stringAt(objectAt(message.text)?.body) ??
      stringAt(content?.caption) ??
      (kind === "UNSUPPORTED" ? `[${type}]` : null),
    mediaId: stringAt(content?.id),
    mediaMime: stringAt(content?.mime_type),
    mediaSha256: stringAt(content?.sha256),
    errorReason: status === "FAILED" ? HISTORY_FAILED : null,
    at,
  };
}

/**
 * `from_user_id` is documented as "only included if the message is from the
 * user", which is the strongest signal in the payload. The rest is the
 * documented fallback order, because a payload can omit both handles.
 */
function directionOf(
  message: Json,
  business: string | null,
): "INBOUND" | "OUTBOUND" {
  if (stringAt(message.from_user_id)) return "INBOUND";
  if (stringAt(message.to)) return "OUTBOUND";

  const from = digits(stringAt(message.from));
  if (business !== null && from !== null && from === business) return "OUTBOUND";

  return "INBOUND";
}

/** One row per number: the highest `progress` any entry of this delivery saw. */
export function historyProgress(payload: unknown): SyncProgress[] {
  const best = new Map<string, number>();

  for (const change of changesOf(payload)) {
    if (change.field !== "history") continue;

    const phoneNumberId = phoneNumberOf(change.value);
    if (!phoneNumberId) continue;

    const entries = Array.isArray(change.value.history)
      ? change.value.history
      : [];

    for (const entry of entries) {
      const progress = numberAt(objectAt(objectAt(entry)?.metadata)?.progress);
      if (progress === null) continue;

      const previous = best.get(phoneNumberId);
      if (previous === undefined || progress > previous) {
        best.set(phoneNumberId, progress);
      }
    }
  }

  return [...best].map(([phoneNumberId, progress]) => ({
    phoneNumberId,
    progress,
  }));
}

/**
 * Meta's decline is the one delivery with no `entry[].changes[]` wrapper: a
 * bare `{ messaging_product, metadata, history }` object. Both shapes are
 * read, because a payload we cannot name is a screen that waits forever.
 */
export function historyDeclined(payload: unknown): DeclinedSync[] {
  const found: DeclinedSync[] = [];
  const root = objectAt(payload);

  const bare = objectAt(root);
  const bareNumber = bare ? phoneNumberOf(bare) : null;
  const bareHistory = bare && Array.isArray(bare.history) ? bare.history : null;

  if (bareNumber && bareHistory) {
    collectDeclines(found, bareNumber, bareHistory);
  }

  for (const change of changesOf(payload)) {
    if (change.field !== "history") continue;

    const phoneNumberId = phoneNumberOf(change.value);
    const entries = Array.isArray(change.value.history)
      ? change.value.history
      : [];

    if (phoneNumberId) collectDeclines(found, phoneNumberId, entries);
  }

  return found;
}

function collectDeclines(
  found: DeclinedSync[],
  phoneNumberId: string,
  entries: unknown[],
): void {
  for (const entry of entries) {
    const errors = Array.isArray(objectAt(entry)?.errors)
      ? (objectAt(entry)!.errors as unknown[])
      : [];

    for (const error of errors) {
      const row = objectAt(error);
      if (numberAt(row?.code) !== DECLINED_CODE) continue;

      found.push({
        phoneNumberId,
        sentence: stringAt(row?.title) ?? DECLINED_TITLE,
      });
    }
  }
}

/**
 * The media that belongs to a placeholder, in its own `field: "history"`
 * delivery. Gated on the field name: a live delivery also carries
 * `value.messages`, and those are already the inbox's business.
 */
export function mediaAssets(payload: unknown): MediaAsset[] {
  const assets: MediaAsset[] = [];

  for (const change of changesOf(payload)) {
    if (change.field !== "history") continue;

    const phoneNumberId = phoneNumberOf(change.value);
    if (!phoneNumberId) continue;

    const messages = Array.isArray(change.value.messages)
      ? change.value.messages
      : [];

    for (const row of messages) {
      const message = objectAt(row);
      const wamid = stringAt(message?.id);
      const type = stringAt(message?.type);
      const at = instantOf(message?.timestamp);

      if (!message || !wamid || !type || !at) continue;

      const kind = kindOf(type);
      // An asset names a real kind. Anything else is not an asset.
      if (!MEDIA_KINDS.has(kind)) continue;

      const content = objectAt(message[type]);

      assets.push({
        phoneNumberId,
        wamid,
        from: stringAt(message.from),
        kind,
        mediaId: stringAt(content?.id),
        mediaMime: stringAt(content?.mime_type),
        mediaSha256: stringAt(content?.sha256),
        caption: stringAt(content?.caption),
        at,
      });
    }
  }

  return assets;
}

export function stateSyncContacts(payload: unknown): SyncedContact[] {
  const contacts: SyncedContact[] = [];

  for (const change of changesOf(payload)) {
    const phoneNumberId = phoneNumberOf(change.value);
    if (!phoneNumberId) continue;

    const rows = Array.isArray(change.value.state_sync)
      ? change.value.state_sync
      : [];

    for (const row of rows) {
      const entry = objectAt(row);
      const contact = objectAt(entry?.contact);
      const action = stringAt(entry?.action);

      if (!contact || (action !== "add" && action !== "remove")) continue;

      contacts.push({
        phoneNumberId,
        phone: stringAt(contact.phone_number),
        bsuid: stringAt(contact.user_id),
        fullName: stringAt(contact.full_name),
        firstName: stringAt(contact.first_name),
        action,
      });
    }
  }

  return contacts;
}
```

- [ ] **Step 3: Write the tests**

`Backend/src/whatsapp/coexistence.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  historyDeclined,
  historyProgress,
  historyThreads,
  mediaAssets,
  stateSyncContacts,
} from "./coexistence";

/**
 * Every case here is a shape Meta's own coexistence documentation prints.
 * These functions decide the direction, the phone number and the kind of a
 * message, and all three are silent when wrong.
 */

const at = "1739212624";

function history(entries: Record<string, unknown>[]) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "history",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "16505551234",
                phone_number_id: "pn-1",
              },
              history: entries,
            },
          },
        ],
      },
    ],
  };
}

test("a chunk yields its threads with a direction per message", () => {
  const payload = history([
    {
      metadata: { phase: 0, chunk_order: 1, progress: 40 },
      threads: [
        {
          id: "919900000000",
          context: { wa_id: "919900000000", user_id: "IN.1" },
          messages: [
            {
              from: "919900000000",
              from_user_id: "IN.1",
              id: "wamid.in",
              timestamp: at,
              type: "text",
              text: { body: "Two dosas" },
              history_context: { status: "read" },
            },
            {
              from: "919900000000",
              from_user_id: "IN.1",
              id: "wamid.media",
              timestamp: at,
              type: "media_placeholder",
              history_context: { status: "delivered" },
            },
            {
              from: "16505551234",
              to: "919900000000",
              id: "wamid.out",
              timestamp: at,
              type: "text",
              text: { body: "On my way" },
              history_context: { status: "sent" },
            },
          ],
        },
      ],
    },
  ]);

  const [thread] = historyThreads(payload);

  assert.equal(thread.phoneNumberId, "pn-1");
  assert.equal(thread.phone, "919900000000");
  assert.equal(thread.bsuid, "IN.1");
  assert.deepEqual(
    thread.messages.map((message) => [message.direction, message.kind, message.status]),
    [
      ["INBOUND", "TEXT", "READ"],
      ["INBOUND", "MEDIA_PENDING", "DELIVERED"],
      ["OUTBOUND", "TEXT", "SENT"],
    ],
  );
  assert.equal(thread.messages[0].body, "Two dosas");
  // A placeholder carries no contents and must not invent a body.
  assert.equal(thread.messages[1].body, null);
  assert.equal(thread.messages[1].mediaId, null);
});

test("a plain from equal to the business number is outbound", () => {
  const payload = history([
    {
      metadata: { phase: 0, chunk_order: 2, progress: 60 },
      threads: [
        {
          id: "919900000000",
          messages: [
            {
              from: "16505551234",
              id: "wamid.plain",
              timestamp: at,
              type: "text",
              text: { body: "Sent from the phone" },
            },
          ],
        },
      ],
    },
  ]);

  const [thread] = historyThreads(payload);

  assert.equal(thread.messages[0].direction, "OUTBOUND");
  // No `history_context`: a fallback, not a guess at a delivery receipt.
  assert.equal(thread.messages[0].status, "SENT");
});

test("a thread with neither a phone nor a user id keeps both null", () => {
  const payload = history([
    {
      metadata: { phase: 1, chunk_order: 1, progress: 100 },
      threads: [{ messages: [] }],
    },
  ]);

  const [thread] = historyThreads(payload);

  assert.equal(thread.phone, null);
  assert.equal(thread.bsuid, null);
});

test("an error status arrives with the sentence the thread shows", () => {
  const payload = history([
    {
      metadata: { phase: 0, chunk_order: 3, progress: 80 },
      threads: [
        {
          id: "919900000000",
          messages: [
            {
              from: "919900000000",
              from_user_id: "IN.1",
              id: "wamid.failed",
              timestamp: at,
              type: "text",
              text: { body: "Hello?" },
              history_context: { status: "error" },
            },
          ],
        },
      ],
    },
  ]);

  const [thread] = historyThreads(payload);

  assert.equal(thread.messages[0].status, "FAILED");
  assert.match(String(thread.messages[0].errorReason), /failed/);
});

test("progress is the highest any entry of the delivery reported", () => {
  const payload = history([
    { metadata: { phase: 0, chunk_order: 1, progress: 30 }, threads: [] },
    { metadata: { phase: 2, chunk_order: 9, progress: 100 }, threads: [] },
  ]);

  assert.deepEqual(historyProgress(payload), [
    { phoneNumberId: "pn-1", progress: 100 },
  ]);
});

test("the declined payload has no envelope and is still recognised", () => {
  // Printed verbatim in Meta's coexistence documentation.
  const payload = {
    messaging_product: "whatsapp",
    metadata: { phone_number_id: "pn-1" },
    history: [
      {
        errors: [
          {
            code: 2593109,
            title:
              "History sync is turned off by the business from the WhatsApp Business app",
            error_data: { details: "The user chose not to share their history." },
          },
        ],
      },
    ],
  };

  assert.deepEqual(historyDeclined(payload), [
    {
      phoneNumberId: "pn-1",
      sentence:
        "History sync is turned off by the business from the WhatsApp Business app",
    },
  ]);
  assert.deepEqual(historyThreads(payload), []);
});

test("a media asset names its real kind and the placeholder's wamid", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "history",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "pn-1" },
              messages: [
                {
                  from: "919900000000",
                  id: "wamid.media",
                  timestamp: at,
                  type: "image",
                  image: {
                    id: "media-1",
                    mime_type: "image/jpeg",
                    sha256: "abc",
                    caption: "The menu",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  assert.deepEqual(mediaAssets(payload), [
    {
      phoneNumberId: "pn-1",
      wamid: "wamid.media",
      from: "919900000000",
      kind: "IMAGE",
      mediaId: "media-1",
      mediaMime: "image/jpeg",
      mediaSha256: "abc",
      caption: "The menu",
      at: new Date(Number(at) * 1000),
    },
  ]);
});

test("a live message delivery is not mistaken for media assets", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "pn-1" },
              messages: [
                {
                  from: "919900000000",
                  id: "wamid.live",
                  timestamp: at,
                  type: "image",
                  image: { id: "media-2", mime_type: "image/png" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  assert.deepEqual(mediaAssets(payload), []);
});

test("a state sync names the contact's number and its action", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "smb_app_state_sync",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "pn-1" },
              state_sync: [
                {
                  type: "contact",
                  action: "add",
                  metadata: { timestamp: at },
                  contact: {
                    full_name: "Ravi Kumar",
                    first_name: "Ravi",
                    phone_number: "919900000000",
                    user_id: "IN.1",
                  },
                },
                {
                  type: "contact",
                  action: "remove",
                  metadata: { timestamp: at },
                  contact: { user_id: "IN.2" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  assert.deepEqual(stateSyncContacts(payload), [
    {
      phoneNumberId: "pn-1",
      phone: "919900000000",
      bsuid: "IN.1",
      fullName: "Ravi Kumar",
      firstName: "Ravi",
      action: "add",
    },
    {
      phoneNumberId: "pn-1",
      phone: null,
      bsuid: "IN.2",
      fullName: null,
      firstName: null,
      action: "remove",
    },
  ]);
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS. The `kindOf` export changes nothing for existing payload tests.

---

### Task 4: One identity rule — `contact.identity.ts`

**Files:**
- Create: `Backend/src/inbox/contact.identity.ts`
- Modify: `Backend/src/inbox/inbox.store.ts` (drop the private `contactFor`, call the shared one)
- Test: `Backend/src/inbox/contact.identity.test.ts` (new)

**Interfaces:**
- Consumes: `StoreAccount` from `./inbox.store` (type-only, erased at runtime, so no import cycle).
- Produces: `ContactRef { phone: string | null; bsuid: string | null }` and `contactFor(prisma, account, ref, profileName, at: Date | null): Promise<{ id: string } | null>` — Tasks 5 calls it.

- [ ] **Step 1: Write the failing test**

`Backend/src/inbox/contact.identity.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaService } from "../prisma/prisma.service";
import { contactFor } from "./contact.identity";

/**
 * One identity rule, two writers. In B1 a phone number is the only handle; the
 * two cases that matter are the message that names none (skipped, never keyed
 * on an empty string) and a phone-book entry, which is not a sighting.
 */

const account = { id: "acct-1", workspaceId: "ws-1", phoneNumberId: "pn-1" };

const at = new Date("2026-11-27T10:00:00Z");

function fake() {
  const upserts: { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }[] = [];

  const prisma = {
    contact: {
      upsert: async (args: {
        where: unknown;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        upserts.push(args);
        return { id: "contact-1" };
      },
    },
  } as unknown as PrismaService;

  return { prisma, upserts };
}

test("a message with no handle resolves to nothing, without a write", async () => {
  const { prisma, upserts } = fake();

  const contact = await contactFor(
    prisma,
    account,
    { phone: null, bsuid: null },
    null,
    at,
  );

  assert.equal(contact, null);
  assert.equal(upserts.length, 0);
});

test("a phone is keyed on the workspace and records the sighting", async () => {
  const { prisma, upserts } = fake();

  const contact = await contactFor(
    prisma,
    account,
    { phone: "919900000000", bsuid: null },
    "Ravi",
    at,
  );

  assert.deepEqual(contact, { id: "contact-1" });
  assert.deepEqual(upserts[0].where, {
    workspaceId_waId: { workspaceId: "ws-1", waId: "919900000000" },
  });
  assert.equal(upserts[0].create.lastSeenAt, at);
  assert.equal(upserts[0].update.lastSeenAt, at);
  assert.equal(upserts[0].update.profileName, "Ravi");
});

test("a phone-book entry is not a sighting, so it moves no timestamp", async () => {
  const { prisma, upserts } = fake();
  const original = new Date("2026-01-01T00:00:00Z");

  await contactFor(
    prisma,
    account,
    { phone: "919900000000", bsuid: null },
    "Bought list",
    null,
  );

  assert.equal("lastSeenAt" in upserts[0].create, false);
  assert.equal("lastSeenAt" in upserts[0].update, false);
  assert.notEqual(upserts[0].create.lastSeenAt, original);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './contact.identity'`.

- [ ] **Step 3: Write the shared rule**

`Backend/src/inbox/contact.identity.ts`:

```ts
import { PrismaService } from "../prisma/prisma.service";
import type { StoreAccount } from "./inbox.store";

/**
 * Who a thread hangs from.
 *
 * One rule, called by the live store and the history store: two copies would
 * drift, and the drift would show up as the same customer owning two threads.
 */
export interface ContactRef {
  phone: string | null;
  /**
   * Business-scoped user id (`user_id` / `from_user_id`). Resolved first in
   * B2; B1 has no column for it yet, so it is accepted and unused — which is
   * why the call sites do not change when the column arrives.
   */
  bsuid: string | null;
}

/**
 * `at` is the instant the contact was last seen *messaging us*. Null means
 * "here is what the phone book says", which must not move `lastSeenAt`: a
 * bought list would otherwise rank as the most active address book on earth.
 */
export function contactFor(
  prisma: PrismaService,
  account: StoreAccount,
  ref: ContactRef,
  profileName: string | null,
  at: Date | null,
): Promise<{ id: string } | null> {
  const phone = ref.phone;

  // No handle at all: the caller counts and skips. B2 adds the `bsuid`
  // branch above this line.
  if (!phone) return Promise.resolve(null);

  return prisma.contact.upsert({
    where: {
      workspaceId_waId: { workspaceId: account.workspaceId, waId: phone },
    },
    create: {
      workspaceId: account.workspaceId,
      waId: phone,
      profileName,
      phoneDisplay: phone,
      ...(at ? { lastSeenAt: at } : {}),
    },
    update: {
      ...(at ? { lastSeenAt: at } : {}),
      // A customer can hide their profile name; keep the last one we saw.
      ...(profileName ? { profileName } : {}),
    },
    select: { id: true },
  });
}
```

- [ ] **Step 4: Point `InboxStore` at it**

In `Backend/src/inbox/inbox.store.ts`:

1. Add the import beside the others:

```ts
import { contactFor } from "./contact.identity";
```

2. Delete the whole `private contactFor(...)` method (with its doc comment, "The customer identity a thread hangs from, created on first sight.").

3. In `storeMessage`, replace the call:

```ts
    const contact = await contactFor(
      this.prisma,
      account,
      { phone: message.from, bsuid: null },
      name?.profileName ?? null,
      message.timestamp,
    );

    // A live delivery always names a phone, so this is a shape guard rather
    // than a real branch — but returning here keeps one rule for both stores.
    if (!contact) return null;
```

4. In `storeEcho`, replace the call the same way with `echo.timestamp`, and return early:

```ts
    if (!contact) return;
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS — including the five existing `inbox.store.test.ts` cases, which still see one `contact.upsert` per message.

---

### Task 5: `HistoryStore`

**Files:**
- Create: `Backend/src/inbox/history.store.ts`
- Modify: `Backend/src/inbox/inbox.module.ts` (provide and export it)
- Test: `Backend/src/inbox/history.store.test.ts` (new)

**Interfaces:**
- Consumes: `contactFor` (Task 4), `HistoryThread` / `MediaAsset` / `SyncedContact` (Task 3), `kindLabel` from `./inbox.view`, `StoreAccount` from `./inbox.store`.
- Produces: `HistoryStore` with `import(account, threads)`, `attachMedia(account, asset)`, `absorbContacts(account, contacts)`, `noteComplete(account)`, `noteDeclined(account, sentence)` — Task 7 injects it.

- [ ] **Step 1: Add `displayPhoneNumber` to the account literal type**

In `Backend/src/inbox/inbox.store.ts`, extend `StoreAccount`:

```ts
export interface StoreAccount {
  id: string;
  workspaceId: string;
  phoneNumberId: string;
  /**
   * Meta's pretty form, e.g. `+91 98000 00000`. Optional because the live path
   * ignores it; the history path needs it to tell the business's own media
   * from a customer's, and `phoneNumberId` is a different kind of id entirely.
   */
  displayPhoneNumber?: string | null;
}
```

- [ ] **Step 2: Write the store**

`Backend/src/inbox/history.store.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import type {
  HistoryMessage,
  HistoryThread,
  MediaAsset,
  SyncedContact,
} from "../whatsapp/coexistence";
import { contactFor } from "./contact.identity";
import type { StoreAccount } from "./inbox.store";
import { kindLabel } from "./inbox.view";

/** Meta caps a chunk in the thousands; 500 keeps one statement modest. */
const BATCH = 500;

const WINDOW_MS = 24 * 60 * 60 * 1000;

const PREVIEW_LIMIT = 140;

/**
 * Writes what the WhatsApp Business app shares into the inbox we already have.
 *
 * Same rules as the live store, for the same reasons: `wamid` is the dedupe
 * key, ordering is decided by an atomic `updateMany ... lt` rather than a read
 * then write, and nothing here returns a row to the reply or lead pipelines —
 * which is what keeps 180 days of history from being answered by a bot.
 */
@Injectable()
export class HistoryStore {
  private readonly logger = new Logger(HistoryStore.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Writes one chunk of threads. Never throws into the webhook. */
  async import(
    account: StoreAccount,
    threads: HistoryThread[],
  ): Promise<{ written: number; skipped: number }> {
    let written = 0;
    let skipped = 0;

    for (const thread of threads) {
      // A delivery can name several numbers; each account takes only its own.
      if (thread.phoneNumberId !== account.phoneNumberId) continue;

      try {
        const result = await this.importThread(account, thread);
        written += result.written;
        skipped += result.skipped;
      } catch (error) {
        this.logger.error(
          `Could not import history for workspace ${account.workspaceId}: ${
            error instanceof Error ? error.message : "unknown failure"
          }`,
        );
      }
    }

    return { written, skipped };
  }

  private async importThread(
    account: StoreAccount,
    thread: HistoryThread,
  ): Promise<{ written: number; skipped: number }> {
    if (thread.messages.length === 0) return { written: 0, skipped: 0 };

    const newest = newestOf(thread.messages);
    const conversation = await this.conversationFor(
      account,
      thread,
      newest,
      previewOf(newest),
    );

    if (!conversation) {
      this.logger.log(
        `Skipped a history thread for ${account.phoneNumberId}: Meta named no phone number (first message ${thread.messages[0].wamid}).`,
      );
      return { written: 0, skipped: thread.messages.length };
    }

    let written = 0;

    for (let index = 0; index < thread.messages.length; index += BATCH) {
      const { count } = await this.prisma.message.createMany({
        data: thread.messages
          .slice(index, index + BATCH)
          .map((message) => rowOf(account, conversation.id, message)),
        skipDuplicates: true,
      });

      written += count;
    }

    await this.touch(conversation.id, newest, previewOf(newest));

    const newestInbound = newestInboundOf(thread.messages);

    // Only a message younger than the window can open one, and only forward:
    // over-reporting hands an agent a free-form send Meta will reject, which
    // costs more than under-reporting it.
    if (newestInbound && Date.now() - newestInbound.at.getTime() < WINDOW_MS) {
      await this.prisma.conversation.updateMany({
        where: {
          id: conversation.id,
          OR: [
            { lastInboundAt: null },
            { lastInboundAt: { lt: newestInbound.at } },
          ],
        },
        data: { lastInboundAt: newestInbound.at },
      });
    }

    return { written, skipped: 0 };
  }

  /** Fills a placeholder, or creates the row when the asset beat its chunk. */
  async attachMedia(account: StoreAccount, asset: MediaAsset): Promise<void> {
    if (asset.phoneNumberId !== account.phoneNumberId) return;

    const filled = await this.prisma.message.updateMany({
      where: {
        wamid: asset.wamid,
        kind: "MEDIA_PENDING",
        workspaceId: account.workspaceId,
      },
      data: {
        kind: asset.kind,
        mediaId: asset.mediaId,
        mediaMime: asset.mediaMime,
        mediaSha256: asset.mediaSha256,
        body: asset.caption,
      },
    });

    if (filled.count > 0) return;

    // A live row already owns this wamid, with better data than an asset. It
    // also cannot be replaced: `wamid` is unique and the live row is the one
    // the customer's own delivery wrote.
    const existing = await this.prisma.message.findUnique({
      where: { wamid: asset.wamid },
      select: { id: true },
    });

    if (existing) return;

    const business = digitsOf(account.displayPhoneNumber);

    // A business-sent asset names the business as its sender and nothing about
    // the recipient, so there is no thread to write it into. Its placeholder
    // arrives on the chunk that carries the thread.
    if (!asset.from || asset.from === business) {
      this.logger.log(
        `A history media asset for ${account.phoneNumberId} has no placeholder and no customer to attach to (${asset.wamid}).`,
      );
      return;
    }

    const conversation = await this.conversationFor(
      account,
      { phoneNumberId: account.phoneNumberId, phone: asset.from, bsuid: null, username: null, messages: [] },
      asset.at,
      previewOf({ body: asset.caption, kind: asset.kind }),
    );

    if (!conversation) return;

    await this.prisma.message.create({
      data: {
        workspaceId: account.workspaceId,
        conversationId: conversation.id,
        direction: "INBOUND",
        kind: asset.kind,
        status: "DELIVERED",
        wamid: asset.wamid,
        body: asset.caption,
        mediaId: asset.mediaId,
        mediaMime: asset.mediaMime,
        mediaSha256: asset.mediaSha256,
        imported: true,
        createdAt: asset.at,
      },
    });

    await this.touch(
      conversation.id,
      { at: asset.at },
      previewOf({ body: asset.caption, kind: asset.kind }),
    );
  }

  /** Applies the address book. Returns how many contacts were written. */
  async absorbContacts(
    account: StoreAccount,
    contacts: SyncedContact[],
  ): Promise<number> {
    let applied = 0;

    for (const row of contacts) {
      if (row.phoneNumberId !== account.phoneNumberId) continue;

      if (row.action === "remove") {
        // The contact may own a conversation, and deleting the row would
        // delete the thread with it.
        this.logger.log(
          `Ignored a contact removal for ${account.phoneNumberId}: the row may own a conversation.`,
        );
        continue;
      }

      if (!row.phone) continue;

      const name = row.fullName ?? row.firstName;

      await this.prisma.contact.upsert({
        where: {
          workspaceId_waId: { workspaceId: account.workspaceId, waId: row.phone },
        },
        create: {
          workspaceId: account.workspaceId,
          waId: row.phone,
          profileName: name,
          phoneDisplay: row.phone,
        },
        // No `lastSeenAt`: a phone-book entry is not a sighting.
        update: {
          phoneDisplay: row.phone,
          ...(name ? { profileName: name } : {}),
        },
      });

      applied += 1;
    }

    return applied;
  }

  /** Meta reported `progress: 100`. */
  async noteComplete(account: StoreAccount): Promise<void> {
    await this.prisma.whatsAppAccount.update({
      where: { id: account.id },
      data: { historySyncDoneAt: new Date() },
    });
  }

  /** The business turned history sharing off; `sentence` is Meta's own title. */
  async noteDeclined(account: StoreAccount, sentence: string): Promise<void> {
    await this.prisma.whatsAppAccount.update({
      where: { id: account.id },
      data: { historySyncDoneAt: new Date(), historySyncError: sentence },
    });
  }

  /** The thread's identity: the contact rule, then the one conversation. */
  private async conversationFor(
    account: StoreAccount,
    ref: { phone: string | null; bsuid: string | null; username: string | null },
    at: Date,
    preview: string,
  ): Promise<{ id: string } | null> {
    const contact = await contactFor(
      this.prisma,
      account,
      { phone: ref.phone, bsuid: ref.bsuid },
      ref.username,
      // A phone-book name is not a sighting; only a message is.
      null,
    );

    if (!contact) return null;

    return this.prisma.conversation.upsert({
      where: {
        accountId_contactId: { accountId: account.id, contactId: contact.id },
      },
      create: {
        workspaceId: account.workspaceId,
        accountId: account.id,
        contactId: contact.id,
        // 180 days must not arrive as red badges.
        unreadCount: 0,
        lastMessageAt: at,
        lastMessagePreview: preview,
      },
      update: {},
      select: { id: true },
    });
  }

  /** Atomic so two chunks racing on one thread cannot reorder it. */
  private async touch(
    conversationId: string,
    newest: { at: Date },
    preview: string,
  ): Promise<void> {
    await this.prisma.conversation.updateMany({
      where: { id: conversationId, lastMessageAt: { lt: newest.at } },
      data: { lastMessageAt: newest.at, lastMessagePreview: preview },
    });
  }
}

function rowOf(
  account: StoreAccount,
  conversationId: string,
  message: HistoryMessage,
): Prisma.MessageCreateManyInput {
  return {
    workspaceId: account.workspaceId,
    conversationId,
    direction: message.direction,
    kind: message.kind,
    status: message.status,
    wamid: message.wamid,
    body: message.body,
    mediaId: message.mediaId,
    mediaMime: message.mediaMime,
    mediaSha256: message.mediaSha256,
    errorReason: message.errorReason,
    imported: true,
    createdAt: message.at,
  };
}

function newestOf(messages: HistoryMessage[]): HistoryMessage {
  return messages.reduce((newest, message) =>
    message.at > newest.at ? message : newest,
  );
}

function newestInboundOf(messages: HistoryMessage[]): HistoryMessage | null {
  const inbound = messages.filter((message) => message.direction === "INBOUND");
  return inbound.length > 0 ? newestOf(inbound) : null;
}

/** What the thread list shows in place of words: the text, or the kind. */
function previewOf(row: { body: string | null; kind: HistoryMessage["kind"] }): string {
  const text = row.body?.trim() || kindLabel(row.kind);
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text;
}

function digitsOf(value: string | null | undefined): string | null {
  return value ? value.replace(/\D/g, "") || null : null;
}
```

- [ ] **Step 3: Provide it**

In `Backend/src/inbox/inbox.module.ts`, add the import and both lists:

```ts
import { HistoryStore } from "./history.store";
```

```ts
  providers: [
    InboxService,
    InboxSender,
    InboxStore,
    HistoryStore,
    InboxGraph,
    MediaStorage,
    SecretBox,
  ],
  exports: [InboxStore, HistoryStore, InboxSender, InboxGraph],
```

Extend the module's doc comment with one line:

```ts
 * `HistoryStore` is exported for the same reason as `InboxStore`: the WhatsApp
 * webhook is the only writer of imported history, and it lives elsewhere.
```

- [ ] **Step 4: Write the tests**

`Backend/src/inbox/history.store.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaService } from "../prisma/prisma.service";
import type { HistoryMessage, HistoryThread, MediaAsset } from "../whatsapp/coexistence";
import { HistoryStore } from "./history.store";

/**
 * Imported history is a second writer into tables the live path owns, with one
 * extra promise: it must not look like a conversation that just happened.
 * These tests read the statements handed to Prisma for exactly that.
 */

const account = {
  id: "acct-1",
  workspaceId: "ws-1",
  phoneNumberId: "pn-1",
  displayPhoneNumber: "+1 650 555 1234",
};

const recent = new Date(Date.now() - 60 * 60 * 1000);
const old = new Date("2026-01-02T10:00:00Z");

function message(overrides: Partial<HistoryMessage> = {}): HistoryMessage {
  return {
    wamid: "wamid.in-1",
    direction: "INBOUND",
    kind: "TEXT",
    status: "DELIVERED",
    body: "Two dosas",
    mediaId: null,
    mediaMime: null,
    mediaSha256: null,
    errorReason: null,
    at: recent,
    ...overrides,
  };
}

function thread(overrides: Partial<HistoryThread> = {}): HistoryThread {
  return {
    phoneNumberId: "pn-1",
    phone: "919900000000",
    bsuid: null,
    username: null,
    messages: [message()],
    ...overrides,
  };
}

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    phoneNumberId: "pn-1",
    wamid: "wamid.media",
    from: "919900000000",
    kind: "IMAGE",
    mediaId: "media-1",
    mediaMime: "image/jpeg",
    mediaSha256: "abc",
    caption: "The menu",
    at: recent,
    ...overrides,
  };
}

function fake(options: { filled?: number; existingWamid?: boolean; written?: number } = {}) {
  const conversationCreates: Record<string, unknown>[] = [];
  const conversationUpdates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const messageBatches: Record<string, unknown>[][] = [];
  const messageCreates: Record<string, unknown>[] = [];
  const contactUpserts: Record<string, unknown>[] = [];
  const accountUpdates: Record<string, unknown>[] = [];

  const prisma = {
    contact: {
      upsert: async (args: { create: Record<string, unknown> }) => {
        contactUpserts.push(args.create);
        return { id: "contact-1" };
      },
    },
    conversation: {
      upsert: async (args: { create: Record<string, unknown> }) => {
        conversationCreates.push(args.create);
        return { id: "conv-1" };
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        conversationUpdates.push(args);
        return { count: 0 };
      },
    },
    message: {
      createMany: async (args: { data: Record<string, unknown>[] }) => {
        messageBatches.push(args.data);
        return { count: options.written ?? args.data.length };
      },
      updateMany: async () => ({ count: options.filled ?? 0 }),
      findUnique: async () => (options.existingWamid ? { id: "msg-live" } : null),
      create: async (args: { data: Record<string, unknown> }) => {
        messageCreates.push(args.data);
        return { id: "msg-1" };
      },
    },
    whatsAppAccount: {
      update: async (args: { data: Record<string, unknown> }) => {
        accountUpdates.push(args.data);
        return {};
      },
    },
  } as unknown as PrismaService;

  return {
    store: new HistoryStore(prisma),
    conversationCreates,
    conversationUpdates,
    messageBatches,
    messageCreates,
    contactUpserts,
    accountUpdates,
  };
}

test("history is imported as imported, and never as unread", async () => {
  const { store, conversationCreates, messageBatches } = fake();

  const result = await store.import(account, [thread()]);

  assert.deepEqual(result, { written: 1, skipped: 0 });
  assert.equal(conversationCreates[0].unreadCount, 0);
  assert.equal("lastInboundAt" in conversationCreates[0], false);
  assert.equal(messageBatches[0][0].imported, true);
  assert.equal(messageBatches[0][0].createdAt, recent);
});

test("a retried chunk adds no second row", async () => {
  const { store } = fake({ written: 0 });

  const result = await store.import(account, [thread()]);

  // `createMany` with `skipDuplicates` answers zero for a chunk it has seen.
  assert.deepEqual(result, { written: 0, skipped: 0 });
});

test("an old inbound message does not open the service window", async () => {
  const { store, conversationUpdates } = fake();

  await store.import(account, [thread({ messages: [message({ at: old })] })]);

  // Only the placement update ran; there is no window write at all.
  assert.equal(conversationUpdates.length, 1);
  assert.equal("lastInboundAt" in conversationUpdates[0].data, false);
});

test("a recent inbound message moves the window forward, atomically", async () => {
  const { store, conversationUpdates } = fake();

  await store.import(account, [thread()]);

  const window = conversationUpdates.find((call) => "lastInboundAt" in call.data);

  assert.ok(window, "the window was never moved");
  assert.deepEqual(window.where, {
    id: "conv-1",
    OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: recent } }],
  });
});

test("an older chunk cannot drag the thread back", async () => {
  const { store, conversationUpdates } = fake();

  await store.import(account, [thread({ messages: [message({ at: old })] })]);

  // The comparison lives in the WHERE clause: a read-then-write would lose a
  // newer chunk that landed between the two statements.
  assert.deepEqual(conversationUpdates[0].where, {
    id: "conv-1",
    lastMessageAt: { lt: old },
  });
});

test("a thread with no phone is counted and skipped", async () => {
  const { store, conversationCreates } = fake();

  const result = await store.import(account, [
    thread({ phone: null, bsuid: "IN.1", messages: [message(), message({ wamid: "wamid.in-2" })] }),
  ]);

  assert.deepEqual(result, { written: 0, skipped: 2 });
  assert.equal(conversationCreates.length, 0);
});

test("a thread for another number is left alone", async () => {
  const { store, conversationCreates } = fake();

  await store.import(account, [thread({ phoneNumberId: "pn-other" })]);

  assert.equal(conversationCreates.length, 0);
});

test("a media asset fills the placeholder it names", async () => {
  const { store, messageCreates } = fake({ filled: 1 });

  await store.attachMedia(account, asset());

  assert.equal(messageCreates.length, 0);
});

test("an inbound asset with no placeholder creates its row", async () => {
  const { store, messageCreates } = fake();

  await store.attachMedia(account, asset());

  assert.equal(messageCreates[0].kind, "IMAGE");
  assert.equal(messageCreates[0].direction, "INBOUND");
  assert.equal(messageCreates[0].imported, true);
  assert.equal(messageCreates[0].wamid, "wamid.media");
});

test("an asset whose sender is the business is left for its own chunk", async () => {
  const { store, messageCreates } = fake();

  await store.attachMedia(account, asset({ from: "16505551234" }));

  // `from` is the business's own number, so the recipient is unknown.
  assert.equal(messageCreates.length, 0);
});

test("an asset whose wamid a live row owns changes nothing", async () => {
  const { store, messageCreates } = fake({ existingWamid: true });

  await store.attachMedia(account, asset());

  assert.equal(messageCreates.length, 0);
});

test("a contact removal is ignored and an add never counts as a sighting", async () => {
  const { store, contactUpserts } = fake();

  const applied = await store.absorbContacts(account, [
    { phoneNumberId: "pn-1", phone: "919900000000", bsuid: "IN.1", fullName: "Ravi Kumar", firstName: "Ravi", action: "remove" },
    { phoneNumberId: "pn-1", phone: "919900000001", bsuid: "IN.2", fullName: null, firstName: "Asha", action: "add" },
  ]);

  assert.equal(applied, 1);
  assert.equal(contactUpserts.length, 1);
  assert.equal("lastSeenAt" in contactUpserts[0], false);
  assert.equal(contactUpserts[0].profileName, "Asha");
});

test("a finished or declined sync is what the screen reads", async () => {
  const { store, accountUpdates } = fake();

  await store.noteComplete(account);
  await store.noteDeclined(account, "turned off");

  assert.ok(accountUpdates[0].historySyncDoneAt instanceof Date);
  assert.equal(accountUpdates[0].historySyncError, undefined);
  assert.equal(accountUpdates[1].historySyncError, "turned off");
});
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, 15 new cases.

---

### Task 6: `CoexistenceStarter`

**Files:**
- Create: `Backend/src/whatsapp/coexistence.starter.ts`
- Test: `Backend/src/whatsapp/coexistence.starter.test.ts` (new)

**Interfaces:**
- Consumes: `MetaGraph.requestSmbAppData` (Task 2), `SecretBox`, `PrismaService`.
- Produces: `AccountForSync` and `CoexistenceStarter.begin(account: AccountForSync): Promise<void>` — Tasks 7 and 8 call it.

- [ ] **Step 1: Write the failing test**

`Backend/src/whatsapp/coexistence.starter.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import type { SecretBox } from "../common/crypto/secret-box";
import type { PrismaService } from "../prisma/prisma.service";
import { CoexistenceStarter } from "./coexistence.starter";
import { MetaRequestError } from "./meta-graph";

/**
 * Each synchronisation may be performed once, ever. So the two things that
 * matter here are the order Meta documents and the rule that a timestamp is
 * written only after Meta accepted — a claimed-but-refused request would look
 * done forever.
 */

const account = {
  id: "acct-1",
  phoneNumberId: "pn-1",
  graphVersion: "v23.0",
  accessTokenCipher: "sealed:tok-1",
  onBizApp: true,
  stateSyncAt: null,
  historySyncAt: null,
};

function fake(options: {
  refusals?: Record<string, Error>;
  updateThrows?: boolean;
} = {}) {
  const calls: { syncType: string; token: string }[] = [];
  const updates: Record<string, unknown>[] = [];

  const meta = {
    requestSmbAppData: async (input: { syncType: string; token: string }) => {
      calls.push({ syncType: input.syncType, token: input.token });

      const refusal = options.refusals?.[input.syncType];
      if (refusal) throw refusal;

      return { requestId: `req-${input.syncType}` };
    },
  };

  const prisma = {
    whatsAppAccount: {
      update: async (args: { data: Record<string, unknown> }) => {
        if (options.updateThrows) throw new Error("database is down");
        updates.push(args.data);
        return {};
      },
    },
  } as unknown as PrismaService;

  const box = { open: (value: string) => value.replace("sealed:", "") } as unknown as SecretBox;

  return {
    starter: new CoexistenceStarter(prisma, meta as never, box),
    calls,
    updates,
  };
}

test("both requests go out, state first, with the documented ids", async () => {
  const { starter, calls, updates } = fake();

  await starter.begin(account);

  assert.deepEqual(
    calls.map((call) => call.syncType),
    ["smb_app_state_sync", "history"],
  );
  assert.equal(calls[0].token, "tok-1");
  assert.equal(updates[0].stateSyncRequestId, "req-smb_app_state_sync");
  assert.ok(updates[0].stateSyncAt instanceof Date);
  assert.equal(updates[1].historySyncRequestId, "req-history");
  assert.equal(updates[1].historySyncError, null);
});

test("a second run makes no call at all", async () => {
  const { starter, calls } = fake();

  await starter.begin({ ...account, stateSyncAt: new Date(), historySyncAt: new Date() });

  assert.equal(calls.length, 0);
});

test("a number that is not in the business app is never asked", async () => {
  const { starter, calls } = fake();

  await starter.begin({ ...account, onBizApp: false });

  assert.equal(calls.length, 0);
});

test("a refused history records the sentence and leaves the stamp null", async () => {
  const refusal = new MetaRequestError(400, {
    message: "Invalid parameter",
    error_data: { details: "This phone number is not eligible for history sync." },
  });
  const { starter, updates } = fake({ refusals: { history: refusal } });

  await starter.begin(account);

  assert.equal(updates[0].stateSyncAt instanceof Date, true);
  assert.equal("historySyncAt" in updates[1], false);
  assert.match(String(updates[1].historySyncError), /not eligible/);
});

test("a refused state sync still asks for the history", async () => {
  const { starter, calls } = fake({
    refusals: {
      smb_app_state_sync: new MetaRequestError(500, { message: "Unknown error" }),
    },
  });

  await starter.begin(account);

  assert.deepEqual(
    calls.map((call) => call.syncType),
    ["smb_app_state_sync", "history"],
  );
});

test("an undecryptable token is a recorded reason, not a crash", async () => {
  const prisma = {
    whatsAppAccount: {
      update: async (args: { data: Record<string, unknown> }) => {
        assert.match(String(args.data.historySyncError), /decrypted/);
        return {};
      },
    },
  } as unknown as PrismaService;

  const starter = new CoexistenceStarter(
    prisma,
    { requestSmbAppData: async () => ({ requestId: null }) } as never,
    { open: () => { throw new Error("bad key"); } } as unknown as SecretBox,
  );

  await starter.begin(account);
});

test("a database that is down does not throw into the webhook", async () => {
  const { starter } = fake({ updateThrows: true });

  await starter.begin(account);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './coexistence.starter'`.

- [ ] **Step 3: Write the starter**

`Backend/src/whatsapp/coexistence.starter.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";

import { SecretBox } from "../common/crypto/secret-box";
import { PrismaService } from "../prisma/prisma.service";
import { MetaGraph, MetaRequestError } from "./meta-graph";

export type SyncKind = "smb_app_state_sync" | "history";

/** The columns `begin` reads, so a caller can pass its own select's row. */
export interface AccountForSync {
  id: string;
  phoneNumberId: string;
  graphVersion: string;
  accessTokenCipher: string;
  onBizApp: boolean;
  stateSyncAt: Date | null;
  historySyncAt: Date | null;
}

/**
 * Asks Meta for the two synchronisations a coexistence number is entitled to.
 *
 * Runs at connect time and again on a reconnect, because the 24-hour clock
 * starts at onboarding and waiting for a screen visit risks the window. Never
 * throws: a connection that succeeded must not be reported as failed because
 * a follow-up call did not.
 */
@Injectable()
export class CoexistenceStarter {
  private readonly logger = new Logger(CoexistenceStarter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaGraph,
    private readonly box: SecretBox,
  ) {}

  async begin(account: AccountForSync): Promise<void> {
    // A plain Cloud API number has no Business app data; asking would only
    // produce an error we would then have to explain away.
    if (!account.onBizApp) return;

    // Both already accepted: each kind may be performed once, so this is the
    // guard that makes a duplicate run (a reconnect and a retry racing) safe.
    if (account.stateSyncAt && account.historySyncAt) return;

    const token = this.openOrNull(account.accessTokenCipher);

    if (!token) {
      await this.recordFailure(
        account.id,
        "The stored access token can no longer be decrypted, so Meta cannot be asked for the sync. Reconnect.",
      );
      return;
    }

    // The documented order, and each kind skipped on its own stamp so a run
    // interrupted between the two resumes at the one that is missing.
    if (!account.stateSyncAt) {
      await this.request(account, token, "smb_app_state_sync");
    }

    if (!account.historySyncAt) {
      await this.request(account, token, "history");
    }
  }

  private async request(
    account: AccountForSync,
    token: string,
    syncType: SyncKind,
  ): Promise<void> {
    try {
      const { requestId } = await this.meta.requestSmbAppData({
        version: account.graphVersion,
        phoneNumberId: account.phoneNumberId,
        token,
        syncType,
      });

      // Written only after Meta accepted: a stamp on a refused request would
      // make the retry look unnecessary forever.
      await this.prisma.whatsAppAccount.update({
        where: { id: account.id },
        data:
          syncType === "history"
            ? {
                historySyncAt: new Date(),
                historySyncRequestId: requestId,
                historySyncError: null,
              }
            : { stateSyncAt: new Date(), stateSyncRequestId: requestId },
      });

      this.logger.log(
        `${syncType} requested for ${account.phoneNumberId} (${requestId ?? "no request id"}).`,
      );
    } catch (error) {
      const sentence = reasonOf(error);

      this.logger.warn(
        `Meta refused the ${syncType} request for ${account.phoneNumberId}: ${sentence}`,
      );

      await this.recordFailure(account.id, sentence);
    }
  }

  /** The one error column is the screen's sentence; never let it throw. */
  private async recordFailure(id: string, sentence: string): Promise<void> {
    try {
      await this.prisma.whatsAppAccount.update({
        where: { id },
        data: { historySyncError: sentence },
      });
    } catch (error) {
      this.logger.warn(
        `Could not record why the sync failed: ${
          error instanceof Error ? error.message : "unknown failure"
        }`,
      );
    }
  }

  private openOrNull(cipher: string): string | null {
    try {
      return this.box.open(cipher);
    } catch {
      return null;
    }
  }
}

function reasonOf(error: unknown): string {
  // `explanation` is the most specific sentence Meta gave us; the plain
  // message is the envelope, which names the call but not the problem.
  if (error instanceof MetaRequestError) return error.explanation;

  return error instanceof Error ? error.message : "Unexpected failure.";
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, 7 new cases.

---

### Task 7: Wiring the sync into `delivery()`

**Files:**
- Modify: `Backend/src/whatsapp/whatsapp-webhook.service.ts`
- Modify: `Backend/src/whatsapp/whatsapp.module.ts`
- Modify: `Backend/src/whatsapp/whatsapp-webhook.account.test.ts` (the fake gains two dependencies)
- Test: `Backend/src/whatsapp/whatsapp-webhook.sync.test.ts` (new)

**Interfaces:**
- Consumes: all five parsers (Task 3), `HistoryStore` (Task 5), `CoexistenceStarter` (Task 6), `StoreAccount` from `../inbox/inbox.store`.
- Produces: a webhook that writes history, contacts and assets; `ACCOUNT_SYNC_SELECT` used only here.

- [ ] **Step 1: Write the failing test**

`Backend/src/whatsapp/whatsapp-webhook.sync.test.ts`:

```ts
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import type { ConfigService } from "@nestjs/config";

import type { ReplyIntake } from "../agents/reply.intake";
import type { SecretBox } from "../common/crypto/secret-box";
import type { LeadIntake } from "../crm/lead.intake";
import type { HistoryStore } from "../inbox/history.store";
import type { InboxStore } from "../inbox/inbox.store";
import type { PrismaService } from "../prisma/prisma.service";
import type { CoexistenceStarter } from "./coexistence.starter";
import type { HistoryThread, MediaAsset, SyncedContact } from "./coexistence";
import { WhatsAppWebhookService } from "./whatsapp-webhook.service";

/**
 * A coexistence delivery must reach the history store and nothing else: an
 * imported message that reached `ReplyIntake` would be answered by a bot, and
 * one that reached `LeadIntake` would rewrite a lead's stage from 180-day-old
 * words. Both are asserted as "was not called".
 */

const SECRET = "platform-secret";

const account = {
  id: "acct-1",
  workspaceId: "ws-1",
  phoneNumberId: "pn-1",
  businessAccountId: "102290129340398",
  displayPhoneNumber: "+1 650 555 1234",
  appSecretCipher: null,
};

function signed(payload: unknown): [raw: Buffer, signature: string] {
  const raw = Buffer.from(JSON.stringify(payload));
  const digest = createHmac("sha256", SECRET).update(raw).digest("hex");

  return [raw, `sha256=${digest}`];
}

function delivery(field: string, value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        time: 1739212624,
        changes: [{ field, value }],
      },
    ],
  };
}

function fake() {
  const imported: HistoryThread[][] = [];
  const absorbed: SyncedContact[][] = [];
  const attached: MediaAsset[] = [];
  const notes: string[] = [];
  const stored: unknown[] = [];
  const queued: unknown[] = [];
  const classified: unknown[] = [];
  const accountUpdates: Record<string, unknown>[] = [];

  const history = {
    import: async (_account: unknown, threads: HistoryThread[]) => {
      imported.push(threads);
      return { written: 1, skipped: 0 };
    },
    absorbContacts: async (_account: unknown, contacts: SyncedContact[]) => {
      absorbed.push(contacts);
      return contacts.length;
    },
    attachMedia: async (_account: unknown, asset: MediaAsset) => {
      attached.push(asset);
    },
    noteComplete: async () => {
      notes.push("complete");
    },
    noteDeclined: async (_account: unknown, sentence: string) => {
      notes.push(sentence);
    },
  } as unknown as HistoryStore;

  const prisma = {
    whatsAppAccount: {
      findMany: async () => [account],
      update: async (args: { data: Record<string, unknown> }) => {
        accountUpdates.push(args.data);
        return account;
      },
    },
    messageTemplate: { updateMany: async () => ({ count: 0 }) },
  } as unknown as PrismaService;

  const config = {
    get: (key: string) => (key === "META_APP_SECRET" ? SECRET : undefined),
  } as unknown as ConfigService;

  const webhook = new WhatsAppWebhookService(
    prisma,
    { open: (value: string) => value } as unknown as SecretBox,
    config,
    {
      record: async (_account: unknown, changes: unknown[]) => {
        stored.push(changes);
        return [];
      },
    } as unknown as InboxStore,
    {
      enqueue: async (...args: unknown[]) => {
        queued.push(args);
      },
    } as unknown as ReplyIntake,
    {
      consider: async (...args: unknown[]) => {
        classified.push(args);
      },
    } as unknown as LeadIntake,
    history,
    { begin: async () => undefined } as unknown as CoexistenceStarter,
  );

  return { webhook, imported, absorbed, attached, notes, stored, queued, classified, accountUpdates };
}

test("a history chunk is imported and still counts as a delivery", async () => {
  const { webhook, imported, stored, queued, classified, accountUpdates } = fake();

  await webhook.delivery(
    ...signed(
      delivery("history", {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "16505551234", phone_number_id: "pn-1" },
        history: [
          {
            metadata: { phase: 0, chunk_order: 1, progress: 100 },
            threads: [
              {
                id: "919900000000",
                messages: [
                  {
                    from: "919900000000",
                    from_user_id: "IN.1",
                    id: "wamid.in",
                    timestamp: "1739212624",
                    type: "text",
                    text: { body: "Two dosas" },
                    history_context: { status: "delivered" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    ),
  );

  assert.equal(imported.length, 1);
  assert.equal(imported[0][0].phone, "919900000000");
  // The stamp the sidebar's "last delivery" reads must move for history too.
  assert.ok(accountUpdates[0].lastEventAt instanceof Date);
  // A history change is not a live message: nothing enters the inbox path.
  assert.equal(stored.length, 0);
  assert.equal(queued.length, 0);
  assert.equal(classified.length, 0);
});

test("progress 100 marks the sync done", async () => {
  const { webhook, notes } = fake();

  await webhook.delivery(
    ...signed(
      delivery("history", {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "pn-1" },
        history: [{ metadata: { phase: 2, chunk_order: 9, progress: 100 }, threads: [] }],
      }),
    ),
  );

  assert.deepEqual(notes, ["complete"]);
});

test("the address book reaches the sync store, not the inbox", async () => {
  const { webhook, absorbed, stored } = fake();

  await webhook.delivery(
    ...signed(
      delivery("smb_app_state_sync", {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "pn-1" },
        state_sync: [
          {
            type: "contact",
            action: "add",
            metadata: { timestamp: "1739212624" },
            contact: { full_name: "Ravi Kumar", phone_number: "919900000000" },
          },
        ],
      }),
    ),
  );

  assert.equal(absorbed.length, 1);
  assert.equal(absorbed[0][0].fullName, "Ravi Kumar");
  assert.equal(stored.length, 0);
});

test("the declined history names its number without an entry wrapper", async () => {
  const { webhook, notes } = fake();

  await webhook.delivery(
    ...signed({
      messaging_product: "whatsapp",
      metadata: { phone_number_id: "pn-1" },
      history: [
        {
          errors: [
            {
              code: 2593109,
              title:
                "History sync is turned off by the business from the WhatsApp Business app",
            },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(notes, [
    "History sync is turned off by the business from the WhatsApp Business app",
  ]);
});

test("a media asset fills the placeholder it names", async () => {
  const { webhook, attached } = fake();

  await webhook.delivery(
    ...signed(
      delivery("history", {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: "pn-1" },
        messages: [
          {
            from: "919900000000",
            id: "wamid.media",
            timestamp: "1739212624",
            type: "image",
            image: { id: "media-1", mime_type: "image/jpeg", sha256: "abc" },
          },
        ],
      }),
    ),
  );

  assert.equal(attached.length, 1);
  assert.equal(attached[0].wamid, "wamid.media");
  assert.equal(attached[0].kind, "IMAGE");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: FAIL to compile — `Expected 6 arguments, but got 8` and `Cannot find module './coexistence.starter'` is satisfied already (Task 6), so only the constructor arity fails.

- [ ] **Step 3: Extend the constructor and the imports**

In `Backend/src/whatsapp/whatsapp-webhook.service.ts`:

```ts
import type { Prisma } from "@prisma/client";

import { HistoryStore } from "../inbox/history.store";
import type { StoreAccount } from "../inbox/inbox.store";
import {
  historyDeclined,
  historyProgress,
  historyThreads,
  mediaAssets,
  stateSyncContacts,
  type DeclinedSync,
  type HistoryThread,
  type MediaAsset,
  type SyncProgress,
  type SyncedContact,
} from "./coexistence";
import { CoexistenceStarter } from "./coexistence.starter";
```

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly box: SecretBox,
    private readonly config: ConfigService,
    private readonly store: InboxStore,
    private readonly intake: ReplyIntake,
    private readonly leads: LeadIntake,
    private readonly history: HistoryStore,
    private readonly coexistence: CoexistenceStarter,
  ) {}
```

Add the select constant below `SWEEP_MS`:

```ts
/** What `CoexistenceStarter.begin` reads, and nothing else. */
const ACCOUNT_SYNC_SELECT = {
  id: true,
  phoneNumberId: true,
  graphVersion: true,
  accessTokenCipher: true,
  onBizApp: true,
  stateSyncAt: true,
  historySyncAt: true,
} satisfies Prisma.WhatsAppAccountSelect;
```

- [ ] **Step 4: Parse once per delivery**

In `delivery()`, after `const accountChanges = accountEvents(payload);`:

```ts
    // Coexistence: parsed once per delivery, beside the template statuses, and
    // each account below takes only the rows that name its number.
    const threads = historyThreads(payload);
    const syncContacts = stateSyncContacts(payload);
    const assets = mediaAssets(payload);
    const progress = historyProgress(payload);
    const declines = historyDeclined(payload);
```

Add `displayPhoneNumber: true` to the `accounts` select, so the history store can tell the business's own media from a customer's.

- [ ] **Step 5: Let the declined payload name its number**

Replace `phoneNumberIds` at the bottom of the file:

```ts
/**
 * `entry[].changes[].value.metadata.phone_number_id`, deduplicated. Meta batches
 * several changes into one delivery, and they can belong to different numbers.
 *
 * The root-level read exists for one payload and one only: Meta's history
 * decline arrives as a bare object with no `entry` wrapper, and without this
 * the refusal names no number, is ignored as unregistered, and the screen waits
 * forever for a sync that was refused.
 */
function phoneNumberIds(payload: unknown): string[] {
  const found = new Set<string>();
  const root = payload as
    | { entry?: unknown; metadata?: { phone_number_id?: unknown } }
    | null;

  const bare = root?.metadata?.phone_number_id;
  if (typeof bare === "string" && bare.length > 0) found.add(bare);

  const entries = root?.entry;
  if (!Array.isArray(entries)) return [...found];

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown } | null)?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = (change as { value?: unknown } | null)?.value;
      const id = (value as { metadata?: { phone_number_id?: unknown } } | null)
        ?.metadata?.phone_number_id;

      if (typeof id === "string" && id.length > 0) found.add(id);
    }
  }

  return [...found];
}
```

- [ ] **Step 6: Narrow `receivedMessage` and run the history path**

Replace the `receivedMessage` line:

```ts
      // A history change carries `metadata.phone_number_id` too, so naming the
      // number is not proof there is a message. Only a parsed change with
      // something in it may run the inbox path.
      const receivedMessage = changes.some(
        (change) =>
          change.phoneNumberId === account.phoneNumberId &&
          (change.contacts.length > 0 ||
            change.messages.length > 0 ||
            change.echoes.length > 0 ||
            change.statuses.length > 0),
      );
```

After `await this.applyAccountEvents(account.id, updates);` — and **before** the `if (receivedMessage)` block — insert:

```ts
      // The same literal `store.record` is given below.
      const target: StoreAccount = {
        id: account.id,
        workspaceId: account.workspaceId,
        phoneNumberId: account.phoneNumberId,
        displayPhoneNumber: account.displayPhoneNumber,
      };

      await this.applySync(target, {
        threads,
        contacts: syncContacts,
        assets,
        progress,
        declines,
      });
```

- [ ] **Step 7: Apply the sync, one isolated step at a time**

Add these two private methods beside `applyAccountEvents`:

```ts
  /**
   * The coexistence half of a delivery: history chunks, the address book and
   * media assets.
   *
   * Each step is isolated. A chunk that fails to write must not stop the live
   * message path beneath it, and must not answer Meta with a 500 for a delivery
   * it would only retry into the same failure.
   */
  private async applySync(
    account: StoreAccount,
    parsed: {
      threads: HistoryThread[];
      contacts: SyncedContact[];
      assets: MediaAsset[];
      progress: SyncProgress[];
      declines: DeclinedSync[];
    },
  ): Promise<void> {
    const mine = (rows: { phoneNumberId: string }[]) =>
      rows.some((row) => row.phoneNumberId === account.phoneNumberId);

    // Nothing in this delivery names this number: skip without a round trip.
    if (
      !mine(parsed.threads) &&
      !mine(parsed.contacts) &&
      !mine(parsed.assets) &&
      !mine(parsed.progress) &&
      !mine(parsed.declines)
    ) {
      return;
    }

    const decline = parsed.declines.find(
      (row) => row.phoneNumberId === account.phoneNumberId,
    );
    const progress = parsed.progress.find(
      (row) => row.phoneNumberId === account.phoneNumberId,
    );

    if (decline) {
      await this.quietly("the declined history", () =>
        this.history.noteDeclined(account, decline.sentence),
      );
    } else if (progress?.progress === 100) {
      await this.quietly("the finished history", () =>
        this.history.noteComplete(account),
      );
    }

    if (mine(parsed.threads)) {
      await this.quietly("a history chunk", () =>
        this.history.import(account, parsed.threads),
      );
    }

    if (mine(parsed.contacts)) {
      await this.quietly("the address book", () =>
        this.history.absorbContacts(account, parsed.contacts),
      );
    }

    for (const asset of parsed.assets) {
      await this.quietly("a media asset", () =>
        this.history.attachMedia(account, asset),
      );
    }
  }

  private async quietly(label: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error(
        `Could not write ${label} for a coexistence delivery: ${
          error instanceof Error ? error.message : "unknown failure"
        }`,
      );
    }
  }
```

- [ ] **Step 8: Honour a reconnect**

Replace the whole `if (event.event === "ACCOUNT_RECONNECTED")` branch in `applyAccountEvents`:

```ts
      if (event.event === "ACCOUNT_RECONNECTED") {
        const row = await this.prisma.whatsAppAccount.update({
          where: { id: accountId },
          data: {
            status: "VERIFIED",
            failureReason: null,
            // Meta re-grants the synchronisation after an offboard/onboard, so
            // stale stamps would suppress a legal sync. `lastVerifiedAt` moves
            // with them because it is what the 24-hour retry window is measured
            // from — leaving it would refuse a sync Meta has just allowed.
            lastVerifiedAt: new Date(),
            lastCheckAt: new Date(),
            stateSyncAt: null,
            stateSyncRequestId: null,
            historySyncAt: null,
            historySyncRequestId: null,
            historySyncDoneAt: null,
            historySyncError: null,
          },
          select: ACCOUNT_SYNC_SELECT,
        });

        // Not awaited: Meta is waiting on this delivery, and a slow Graph call
        // here becomes a retried webhook. The stamps make a duplicate run safe.
        void this.coexistence.begin(row).catch((error: unknown) => {
          this.logger.warn(
            `Could not request the sync for ${row.phoneNumberId}: ${
              error instanceof Error ? error.message : "unknown failure"
            }`,
          );
        });

        this.logger.log(`Account ${event.wabaId} is connected again.`);
      }
```

- [ ] **Step 9: Provide the starter**

In `Backend/src/whatsapp/whatsapp.module.ts`:

```ts
import { CoexistenceStarter } from "./coexistence.starter";
```

```ts
  providers: [
    WhatsAppService,
    WhatsAppWebhookService,
    CoexistenceStarter,
    MetaGraph,
    SecretBox,
  ],
```

`HistoryStore` arrives through the existing `InboxModule` import, which now exports it.

- [ ] **Step 10: Repair the existing account test's fake**

In `Backend/src/whatsapp/whatsapp-webhook.account.test.ts`, add the two imports:

```ts
import type { HistoryStore } from "../inbox/history.store";
import type { CoexistenceStarter } from "./coexistence.starter";
```

The reconnect branch now reads the updated row, so the fake's `update` returns it:

```ts
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        accountUpdates.push(args);
        return account;
      },
```

and the construction gains the last two arguments:

```ts
  const webhook = new WhatsAppWebhookService(
    prisma,
    { open: (value: string) => value } as unknown as SecretBox,
    config,
    { record: async () => [] } as unknown as InboxStore,
    { enqueue: async () => undefined } as unknown as ReplyIntake,
    { consider: async () => undefined } as unknown as LeadIntake,
    {
      import: async () => ({ written: 0, skipped: 0 }),
      attachMedia: async () => undefined,
      absorbContacts: async () => 0,
      noteComplete: async () => undefined,
      noteDeclined: async () => undefined,
    } as unknown as HistoryStore,
    { begin: async () => undefined } as unknown as CoexistenceStarter,
  );
```

- [ ] **Step 11: Run the tests**

Run: `npm test`
Expected: PASS — 5 new cases in the sync test, and the four account cases unchanged except that a reconnect now writes more columns.

---

### Task 8: Turn the sync on from `connectEmbedded`, and offer the retry

**Files:**
- Modify: `Backend/src/whatsapp/whatsapp.service.ts`
- Modify: `Backend/src/whatsapp/whatsapp.controller.ts`
- Test: `Backend/src/whatsapp/whatsapp.service.embedded.test.ts` (extend)

**Interfaces:**
- Consumes: `CoexistenceStarter.begin` (Task 6).
- Produces: `PublicAccount.onBizApp`, `PublicAccount.sync: CoexistenceSyncView`, and `WhatsAppService.syncNow(claims)` behind `POST /v1/whatsapp/connection/sync` — Task 10 renders both.

- [ ] **Step 1: Extend the embedded test**

In `Backend/src/whatsapp/whatsapp.service.embedded.test.ts`:

```ts
import type { CoexistenceStarter } from "./coexistence.starter";
```

`service()` gains a recorded array and the sixth dependency:

```ts
function service(owned: string[], isOnBizApp = false) {
  const written: Record<string, unknown>[] = [];
  const started: { onBizApp: boolean }[] = [];
```

```ts
  return {
    service: new WhatsAppService(prisma, workspaces, meta, box, config, {
      begin: async (row: { onBizApp: boolean }) => {
        started.push(row);
      },
    } as unknown as CoexistenceStarter),
    written,
    started,
  };
```

Then two new tests:

```ts
test("a number that stays in the business app has the sync asked for", async () => {
  const { service: whatsapp, written, started } = service(
    ["109800000000000"],
    true,
  );

  await whatsapp.connectEmbedded(claims, wabaOnly);

  assert.equal(written[0].onBizApp, true);
  assert.equal(started.length, 1);
  assert.equal(started[0].onBizApp, true);
});

test("a plain cloud number is never asked for business-app data", async () => {
  const { service: whatsapp, started } = service(["109800000000000"], false);

  await whatsapp.connectEmbedded(claims, wabaOnly);

  // `begin` is still called: it is the one place that decides, so the rule
  // cannot drift between the caller and the starter.
  assert.equal(started.length, 1);
  assert.equal(started[0].onBizApp, false);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: FAIL — `Expected 5 arguments, but got 6`.

- [ ] **Step 3: Add the view and select the columns**

In `Backend/src/whatsapp/whatsapp.service.ts`:

```ts
import { CoexistenceStarter } from "./coexistence.starter";
```

```ts
/**
 * What the connection screen knows about the 24-hour synchronisation.
 *
 * Computed from the stamps rather than stored as a status, because "requested
 * but not finished" is a real state that no single timestamp names.
 */
export interface CoexistenceSyncView {
  /** False means the card is absent: the number has no business-app data. */
  onBizApp: boolean;
  /** When Meta accepted the history request; null means it was never asked. */
  requestedAt: string | null;
  /** Meta's own id, which its support asks for. Not a webhook key. */
  requestId: string | null;
  doneAt: string | null;
  /** Meta's sentence: a refusal, a decline, a dead token. */
  error: string | null;
  /** True only while something is still unrequested and the window is open. */
  retryAllowed: boolean;
}
```

`PublicAccount` gains, after `source`:

```ts
  /** True when the number is also in use in the WhatsApp Business app. */
  onBizApp: boolean;
  /** The 24-hour synchronisation, in the shape the screen reads. */
  sync: CoexistenceSyncView;
```

`ACCOUNT_SELECT` gains, after `source: true`:

```ts
  onBizApp: true,
  stateSyncAt: true,
  stateSyncRequestId: true,
  historySyncAt: true,
  historySyncRequestId: true,
  historySyncDoneAt: true,
  historySyncError: true,
```

Add `SYNC_SELECT` after `ACCOUNT_SELECT`:

```ts
/** What a sync retry reads: the two request stamps and the window's anchor. */
const SYNC_SELECT = {
  id: true,
  phoneNumberId: true,
  graphVersion: true,
  accessTokenCipher: true,
  onBizApp: true,
  stateSyncAt: true,
  historySyncAt: true,
  historySyncRequestId: true,
  historySyncDoneAt: true,
  historySyncError: true,
  lastVerifiedAt: true,
} satisfies Prisma.WhatsAppAccountSelect;
```

Add the module-level helpers beside `stageOf`:

```ts
const SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;

function withinSyncWindow(at: Date | null): boolean {
  return at !== null && Date.now() - at.getTime() <= SYNC_WINDOW_MS;
}

function syncViewOf(row: {
  onBizApp: boolean;
  stateSyncAt: Date | null;
  historySyncAt: Date | null;
  historySyncRequestId: string | null;
  historySyncDoneAt: Date | null;
  historySyncError: string | null;
  lastVerifiedAt: Date | null;
}): CoexistenceSyncView {
  return {
    onBizApp: row.onBizApp,
    requestedAt: row.historySyncAt?.toISOString() ?? null,
    requestId: row.historySyncRequestId,
    doneAt: row.historySyncDoneAt?.toISOString() ?? null,
    error: row.historySyncError,
    // Once both kinds were accepted there is nothing left to ask for; once it
    // is done, asking again needs the customer to offboard and onboard.
    retryAllowed:
      row.onBizApp &&
      row.historySyncDoneAt === null &&
      (!row.stateSyncAt || !row.historySyncAt) &&
      withinSyncWindow(row.lastVerifiedAt),
  };
}
```

`toPublic` gains, after `source: row.source`:

```ts
      onBizApp: row.onBizApp,
      sync: syncViewOf(row),
```

- [ ] **Step 4: Inject the starter and fire it from `connectEmbedded`**

Constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly meta: MetaGraph,
    private readonly box: SecretBox,
    private readonly config: ConfigService,
    private readonly coexistence: CoexistenceStarter,
  ) {
```

In `connectEmbedded`, add `onBizApp` to `values` (after `businessName,`):

```ts
      onBizApp: phone.is_on_biz_app === true,
```

and after the `upsert` and before `const number = ...`:

```ts
    // The 24-hour clock starts at onboarding, so the two calls are made here
    // rather than when the screen is next opened. Awaited because a person is
    // waiting for the verdict, and these take about as long as the six Graph
    // reads above. `begin` itself decides whether they are legal.
    await this.coexistence.begin({
      id: row.id,
      phoneNumberId: row.phoneNumberId,
      graphVersion: row.graphVersion,
      accessTokenCipher: row.accessTokenCipher,
      onBizApp: row.onBizApp,
      stateSyncAt: row.stateSyncAt,
      historySyncAt: row.historySyncAt,
    });
```

The sync columns are deliberately **not** in `values`: reconnecting the same number must not erase what Meta already answered.

- [ ] **Step 5: Add the retry**

After the `connection` method:

```ts
  /**
   * Asks Meta again for whatever the synchronisation is still missing.
   *
   * The only honest retry. Inside the 24-hour window Meta can still say yes,
   * and a transport failure that stole the first attempt is the customer's
   * problem only if nothing lets them fix it.
   */
  async syncNow(claims: AuthClaims): Promise<{ sync: CoexistenceSyncView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const row = await defaultAccount(this.prisma, workspaceId, SYNC_SELECT);

    if (!row) {
      throw new BadRequestException("Connect a number first.");
    }

    if (!row.onBizApp) {
      throw new BadRequestException(
        "This number is not used in the WhatsApp Business app, so there is no history to sync.",
      );
    }

    // Something is still unrequested. Both accepted is a no-op answered with
    // the current state, not an error: a screen may repeat itself.
    const pending = !row.stateSyncAt || !row.historySyncAt;

    if (pending && !withinSyncWindow(row.lastVerifiedAt)) {
      throw new BadRequestException(
        "Meta only accepts this within 24 hours of connecting. The customer has to disconnect and connect again from the WhatsApp Business app.",
      );
    }

    if (pending) {
      await this.coexistence.begin(row);
    }

    const after = await defaultAccount(this.prisma, workspaceId, SYNC_SELECT);

    return { sync: syncViewOf(after ?? row) };
  }
```

- [ ] **Step 6: Expose the route**

In `Backend/src/whatsapp/whatsapp.controller.ts`, after the `connection` handler:

```ts
  /**
   * POST /api/v1/whatsapp/connection/sync — asks Meta again for whatever the
   * 24-hour synchronisation is still missing.
   *
   * Throttled like `connect`: every accepted call reaches Graph, and Meta
   * allows each kind once, so a stray tap must not become a loop.
   */
  @Post("connection/sync")
  @Roles("OWNER")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  syncConnection(@CurrentUser() claims: AuthClaims) {
    return this.whatsapp.syncNow(claims);
  }
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npm test` then `npm run typecheck`
Expected: PASS. `syncViewOf` is satisfied by both `AccountRow` and the `SYNC_SELECT` row.

---

### Task 9: `MEDIA_PENDING` and `imported` in the inbox

**Files:**
- Modify: `Backend/src/inbox/inbox.view.ts`
- Modify: `frontend/src/features/inbox/api.ts`
- Modify: `frontend/src/features/inbox/components/message-media.tsx`
- Modify: `frontend/src/features/inbox/components/message-thread.tsx`

**Interfaces:**
- Consumes: `Message.imported` and `MessageKind.MEDIA_PENDING` (Task 1); `HistoryStore` writes them (Task 5).
- Produces: `MessageView.imported` and `InboxMessage.imported` on the wire; one new bubble label.

- [ ] **Step 1: Backend view**

In `Backend/src/inbox/inbox.view.ts`:

`MESSAGE_SELECT`, after `kind: true`:

```ts
  imported: true,
```

`MessageView`, after `kind: MessageKind;`:

```ts
  /** A row mirrored from the WhatsApp Business app's history. */
  imported: boolean;
```

`messageView`, after `kind: row.kind,`:

```ts
    imported: row.imported,
```

`kindLabel`, before `default:`:

```ts
    case "MEDIA_PENDING":
      // The chunk said a media message exists and nothing about its type; the
      // asset either lands or it does not.
      return "[media]";
```

Leave `MEDIA_KINDS` alone: a placeholder carries no file, and describing one
would make the bubble claim the attachment is gone.

- [ ] **Step 2: Frontend types**

In `frontend/src/features/inbox/api.ts`, add to the `MessageKind` union after `"REACTION"`:

```ts
  | "MEDIA_PENDING"
```

and to `InboxMessage`, after `kind: MessageKind;`:

```ts
  /** A row mirrored from the business's own phone, not a live delivery. */
  imported: boolean;
```

- [ ] **Step 3: The placeholder label**

In `frontend/src/features/inbox/components/message-media.tsx`, add `ImageOff` to the `lucide-react` import list, then add to `LABELS`:

```ts
  MEDIA_PENDING: {
    label: "This message's media was not shared.",
    icon: <ImageOff aria-hidden="true" className="size-3.5 shrink-0" />,
  },
```

- [ ] **Step 4: The mirror label**

In `frontend/src/features/inbox/components/message-thread.tsx`, add `Smartphone` to the `lucide-react` import list (keep it alphabetical, after `SmilePlus`), then insert after the `{message.template ? … : null}` block and before the `{message.body && …}` block:

```tsx
          {/* A send the business made on its phone and we mirrored in. Without
              this an agent reads it as a colleague's reply. */}
          {message.imported && outbound ? (
            <p className="mb-1 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
              <Smartphone aria-hidden="true" className="size-3 shrink-0" />
              <span>WhatsApp Business app</span>
            </p>
          ) : null}
```

- [ ] **Step 5: Verify both halves**

Run in `Backend/`: `npm run typecheck` then `npx nest build`.
Run in `frontend/`: `npx tsc --noEmit` then `npx eslint . --max-warnings=0`.
Expected: all clean. A `MessageView` consumer that forgets `imported` fails the typecheck, which is the point.

---

### Task 10: The connection card and its retry button

**Files:**
- Modify: `frontend/src/features/whatsapp/components/api.ts`
- Create: `frontend/src/features/whatsapp/components/coexistence-card.tsx`
- Modify: `frontend/src/features/whatsapp/components/live-panel.tsx`

**Interfaces:**
- Consumes: `PublicAccount.onBizApp` and `PublicAccount.sync` (Task 8); `POST /v1/whatsapp/connection/sync`.
- Produces: nothing later depends on it.

- [ ] **Step 1: The client**

In `frontend/src/features/whatsapp/components/api.ts`:

```ts
/** What the screen knows about the 24-hour synchronisation. */
export interface CoexistenceSync {
  /** False means the card is absent: the number has no business-app data. */
  onBizApp: boolean;
  /** When Meta accepted the history request; null means it was never asked. */
  requestedAt: string | null;
  /** Meta's own id. It is what Meta's support asks for, not a webhook key. */
  requestId: string | null;
  doneAt: string | null;
  /** Meta's sentence: a refusal, a decline, a dead token. */
  error: string | null;
  /** True only while something is still unrequested and the window is open. */
  retryAllowed: boolean;
}
```

`WhatsAppAccount` gains, after `source`:

```ts
  /** True when the number is also usable in the WhatsApp Business app. */
  onBizApp: boolean;
  /** The 24-hour synchronisation, in the shape this screen reads. */
  sync: CoexistenceSync;
```

and, beside the other calls:

```ts
/** Asks Meta again for whatever the 24-hour sync is still missing. */
export function startHistorySync(): Promise<{ sync: CoexistenceSync }> {
  return request<{ sync: CoexistenceSync }>("/v1/whatsapp/connection/sync", {
    method: "POST",
  });
}
```

- [ ] **Step 2: The card**

`frontend/src/features/whatsapp/components/coexistence-card.tsx`:

```tsx
"use client";

import * as React from "react";
import { History, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import {
  ApiError,
  startHistorySync,
  type CoexistenceSync,
} from "./api";

/**
 * The 24-hour obligation, said plainly.
 *
 * Three things make this card different from the rest of the panel: the sync
 * can be asked for only once per kind, only inside 24 hours of connecting, and
 * Meta's acceptance is not the same as its delivery. So the copy names the
 * phase the stamps describe, and the button exists only while asking again
 * could still work.
 */

export type SyncState = "idle" | "failed" | "sending" | "done" | "declined";

/** The stamps decide the state; no sentence is parsed back into a state. */
export function syncState(sync: CoexistenceSync): SyncState {
  if (sync.doneAt && sync.error) return "declined";
  if (sync.doneAt) return "done";
  if (sync.requestedAt) return "sending";
  if (sync.error) return "failed";
  return "idle";
}

export function CoexistenceCard({ sync }: { sync: CoexistenceSync }) {
  const toast = useToast();
  const [current, setCurrent] = React.useState(sync);
  const [pending, setPending] = React.useState(false);

  const state = syncState(current);

  async function retry() {
    setPending(true);

    try {
      const result = await startHistorySync();
      setCurrent(result.sync);

      toast.push({
        tone: result.sync.error ? "info" : "success",
        title: result.sync.error ? "Meta did not accept it" : "Asked Meta again",
        description:
          result.sync.error ??
          "The history arrives in phases; keep the WhatsApp Business app open.",
      });
    } catch (error) {
      toast.push({
        tone: "error",
        title: "Could not ask Meta",
        description:
          error instanceof ApiError ? error.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background px-3 py-3">
      <div className="flex items-start gap-2.5">
        <History aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold text-foreground">
            History from the WhatsApp Business app
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {state === "idle"
              ? "Meta has not been asked for this number's history yet."
              : state === "failed"
                ? `Meta refused the sync request: ${current.error}`
                : state === "sending"
                  ? "Meta accepted the request and is sending the history. It arrives in phases covering 180 days; keep the WhatsApp Business app open until it finishes."
                  : state === "done"
                    ? "History synchronised."
                    : "The business turned history sharing off in the WhatsApp Business app. Nothing was imported."}
          </p>

          {current.retryAllowed && (state === "idle" || state === "failed") ? (
            <Button
              className="mt-3"
              disabled={pending}
              onClick={retry}
              size="sm"
              variant={state === "failed" ? "outline" : "default"}
            >
              {pending ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <History aria-hidden="true" />
              )}
              {state === "failed" ? "Try again" : "Start sync"}
            </Button>
          ) : null}

          {state === "failed" && !current.retryAllowed ? (
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Meta only accepts this within 24 hours of connecting. Disconnect
              and connect again from the WhatsApp Business app to start it over.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Render it**

In `frontend/src/features/whatsapp/components/live-panel.tsx`:

```ts
import { CoexistenceCard } from "./coexistence-card";
```

and, directly after the closing `</dl>`:

```tsx
      {account.onBizApp ? <CoexistenceCard sync={account.sync} /> : null}
```

- [ ] **Step 4: Verify**

Run in `frontend/`: `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `npm run build`.
Expected: all clean.

---

### Task 11: The gates, and the one thing only an operator can do

**Files:** none.

- [ ] **Step 1: Backend gates**

Run in `Backend/`:

```powershell
npm test
npm run typecheck
npx nest build
npx prisma validate
```

Expected: tests pass (the suite was 390 before this slice), typecheck silent, `nest build` silent, schema valid.

- [ ] **Step 2: Frontend gates**

Run in `frontend/`:

```powershell
npx tsc --noEmit
npx eslint . --max-warnings=0
npm run build
```

Expected: all silent.

- [ ] **Step 3: Check the diff reads as one story**

Run: `git status --short` and `git diff --stat`
Expected: the twelve touched files, no stray `.next` or `.test-dist` entries (both are ignored), and no secrets in the diff.

- [ ] **Step 4: Hand the operator their half**

Meta's App Dashboard must subscribe the app to four webhook fields before any of this can be seen working: `account_update`, `history`, `smb_app_state_sync`, `smb_message_echoes`. Without them `connectEmbedded` succeeds, both sync calls are accepted, and nothing ever arrives — which looks exactly like a Meta outage. State this in the hand-over; nothing in the code can do it.

- [ ] **Step 5: Stop**

Do not commit, do not push, do not deploy. Report which gates ran, their output, and the operator step above.

---

## What B1 deliberately leaves for B2

- A history message Meta sends with no phone number is counted and logged, not imported. Every other customer's history lands.
- `contactFor` accepts `bsuid` and ignores it; the `Contact` columns, the resolution order, the live-payload identity change and the composer's refusal on a phone-less thread are all B2.
- The two contact rows a coexistence migration can produce for one person are left split, as the spec decides.
