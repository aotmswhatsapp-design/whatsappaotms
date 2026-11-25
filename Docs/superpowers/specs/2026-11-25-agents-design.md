# AI Agents — design

Status: proposed 2026-11-25 — awaiting review. Scope: per-number AI agents
trained on text and files, answering customers in the Inbox. WhatsApp only.

## Goal

A workspace gives one of its WhatsApp numbers an agent, feeds it the business's
own material — a price list, a policy PDF, a product sheet, a video demo — and
the agent answers customer questions in the inbox from that material until a
human takes the conversation over. Nothing is fine-tuned: the agent reads the
relevant pages at answer time, so a corrected price is live the moment the
source is corrected.

## What this is not

- **Not a training job.** No model weights change and no fine-tune is
  submitted. "Training" in this document always means *indexing*: extract text,
  split it, embed it, store the vectors. The word is kept because that is what
  the customer is doing; the mechanism must not be described to them as
  something else.
- **Not Meta's Business AI.** Meta's AI in WhatsApp Business Suite has no API,
  the same wall campaigns hit. This agent is ours and OpenAI's.
- **Not a general assistant.** It answers inbound messages inside the 24-hour
  service window and never opens a conversation. It has no tool access, cannot
  issue a template, cannot create an order, cannot reach any CRM, and cannot
  send a file. Its whole output is one text message.
- **Not autonomous over a human.** One human reply ends its involvement until
  someone deliberately resumes it.
- **Not verified against Gemini in this pass.** The OpenAI key exists and was
  proven live; there is no `GEMINI_API_KEY` in `Backend/.env` yet, so every
  media path in this document is specified from the API contract and has not
  been exercised.

## Decisions taken

| Decision | Choice | Why |
| --- | --- | --- |
| Agent scope | One row per `WhatsAppAccount`, N agents per number, exactly one active | The number is the thing that answers; a workspace-wide agent would answer for a number it was never trained for |
| Active rule | Partial unique index `WHERE is_active` | "One active per number" is a database fact, not a service convention that two concurrent activations can break |
| Chat provider | OpenAI, `gpt-5.4-mini` default, per-agent override | Verified live on this key: reply, `temperature`, `max_completion_tokens` |
| Token parameter | `max_completion_tokens` only | `max_tokens` answers 400 `unsupported_parameter` on the whole `gpt-5.x` family — verified, twice |
| Embeddings | `text-embedding-3-small`, 1536 dims | Native dimension, so no truncation trick; batches of 3 verified |
| Media extraction | Gemini, one adapter for image, audio, video | OpenAI has no video input on any of its 103 models; Gemini reads all three natively, so no ffmpeg and no Docker change on Render |
| Knowledge | pgvector chunk table, HNSW cosine | Extension is available on the project (`0.8.2`, not yet installed); one migration, no new service |
| Retrieval | Top 6 chunks, floor `0.25`, live query per message | A fixed threshold is model- and corpus-dependent, so the floor only drops near-zero matches; a higher one would silently refuse questions the material does answer |
| Reply path | `InboxSender.text()` | The reply becomes the same row, tick states and queue preview a human reply does — nothing to reconcile |
| Execution | Database queue + in-process claim loop | The webhook must answer Meta in well under a second; an LLM call cannot be inline. Same pattern as `CampaignsRunner` |
| Autonomy | Auto-reply until a human replies in the thread | The only model that does not need a customer decision before it is safe |
| Handoff | Pause + reason, never a status change | `ConversationStatus` semantics belong to the Inbox; writing `PENDING` here would silently redefine them |
| Metering | Tokens on every run, cost derived at read time, nothing blocked | Tokens are the record; a price table changes and a stored figure would then be a lie |
| Chunking | ~800 tokens, 15% overlap, characters as the proxy | No tokenizer dependency; 3,200/480 characters is close enough that retrieval quality is unaffected |

## Two keys, one adapter each

`OPENAI_API_KEY` (present) powers chat and embeddings. `GEMINI_API_KEY` (absent)
powers media. They are separate classes behind one interface so no caller knows
which vendor answers:

```ts
interface AgentProvider {
  chat(input: ChatInput): Promise<{ text: string; tokensIn: number; tokensOut: number }>;
  embed(input: string[]): Promise<{ vectors: number[][]; tokens: number }>;
}

interface MediaExtractor {
  /** Throws MediaExtractorMissing when no key is configured. */
  read(input: { bytes: Buffer; mime: string; name: string }): Promise<{ text: string }>;
}
```

Neither vendor gets an SDK. `MediaStorage` and `InboxGraph` are plain `fetch`,
and three vendors is not a reason to add three SDKs to a Nest build.

Verified against the live key, and binding on the implementation:

| Call | Result |
| --- | --- |
| `gpt-4.1-mini`, `gpt-5.4-mini` | reply, finish `stop` |
| `gpt-5.4-mini` + `temperature: 0.4` | accepted |
| `gpt-5.4-mini` + `max_tokens` | **400** — use `max_completion_tokens` |
| `text-embedding-3-small`, 1 and 3 inputs | 1536 dims, 12 and 14 tokens |

## Data model — migration `0015_agents`

```prisma
enum AgentSourceKind   { TEXT FILE }
enum AgentSourceStatus { PENDING PROCESSING READY FAILED }
enum AgentRunKind      { REPLY PLAYGROUND }
enum AgentRunStatus    { QUEUED CLAIMED SENT SKIPPED FAILED }

model Agent {
  id                String   @id @default(uuid()) @db.Uuid
  workspaceId       String   @map("workspace_id") @db.Uuid
  whatsappAccountId String   @map("whatsapp_account_id") @db.Uuid
  name              String
  description       String?
  /// The instructions. Never a place for customer text: that arrives as a turn.
  systemPrompt      String   @map("system_prompt")
  model             String   @default("gpt-5.4-mini")
  temperature       Float    @default(0.4)
  maxReplyChars     Int      @default(900) @map("max_reply_chars")
  escalateKeywords  String[] @default([]) @map("escalate_keywords")
  isActive          Boolean  @default(false) @map("is_active")
  createdByUserId   String?  @map("created_by_user_id") @db.Uuid
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  workspace Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  account   WhatsAppAccount   @relation(fields: [whatsappAccountId], references: [id], onDelete: Cascade)
  sources   KnowledgeSource[]
  runs      AgentRun[]
  messages  Message[]

  @@index([whatsappAccountId, isActive])
  @@index([workspaceId, createdAt])
  @@map("agents")
}

/// One upload or typed note. `storagePath` survives the chunks, so a source can
/// be re-indexed against a new embedding model without asking for the file again.
model KnowledgeSource {
  id          String              @id @default(uuid()) @db.Uuid
  agentId     String              @map("agent_id") @db.Uuid
  kind        AgentSourceKind
  title       String
  mime        String?
  size        Int?
  storagePath String?             @map("storage_path")
  /// The extracted text, kept verbatim. Re-embedding reads this, not the vendor.
  text        String?
  status      AgentSourceStatus   @default(PENDING)
  error       String?
  charCount   Int                 @default(0) @map("char_count")
  chunkCount  Int                 @default(0) @map("chunk_count")
  embedTokens Int                 @default(0) @map("embed_tokens")
  /// Indexing attempts. A row that keeps failing is left FAILED, not looped.
  attempts    Int                 @default(0)
  indexedAt   DateTime?           @map("indexed_at")
  createdAt   DateTime            @default(now()) @map("created_at")
  updatedAt   DateTime            @updatedAt @map("updated_at")

  agent  Agent            @relation(fields: [agentId], references: [id], onDelete: Cascade)
  chunks KnowledgeChunk[]

  @@index([agentId, createdAt])
  @@map("knowledge_sources")
}

model KnowledgeChunk {
  id        String   @id @default(uuid()) @db.Uuid
  sourceId  String   @map("source_id") @db.Uuid
  ord       Int
  text      String
  tokens    Int
  /// Nullable because Prisma can neither read nor write a vector: the row is
  /// created here and the vector is filled by raw SQL. A row with no embedding
  /// is invisible to search, which is exactly right for a half-finished index.
  embedding Unsupported("vector(1536)")?
  createdAt DateTime @default(now()) @map("created_at")

  source KnowledgeSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)

  @@unique([sourceId, ord])
  @@index([sourceId])
  @@map("knowledge_chunks")
}

/// One claimable unit of AI work. A reply and a playground question are both
/// runs, so the usage screen has one table to sum.
model AgentRun {
  id                String         @id @default(uuid()) @db.Uuid
  workspaceId       String         @map("workspace_id") @db.Uuid
  agentId           String         @map("agent_id") @db.Uuid
  kind              AgentRunKind   @default(REPLY)
  conversationId    String?        @map("conversation_id") @db.Uuid
  /// Unique: a retried Meta delivery can never produce a second reply.
  inboundMessageId  String?        @unique @map("inbound_message_id") @db.Uuid
  outboundMessageId String?        @map("outbound_message_id") @db.Uuid
  status            AgentRunStatus @default(QUEUED)
  /// Why a run was left unsent, in one word: paused, superseded, window-closed,
  /// no-context, no-agent, handoff.
  reason            String?
  tokensIn          Int            @default(0) @map("tokens_in")
  tokensOut         Int            @default(0) @map("tokens_out")
  embeddingTokens   Int            @default(0) @map("embedding_tokens")
  latencyMs         Int?           @map("latency_ms")
  error             String?
  attempts          Int            @default(0)
  claimedAt         DateTime?      @map("claimed_at")
  createdAt         DateTime       @default(now()) @map("created_at")
  updatedAt         DateTime       @updatedAt @map("updated_at")

  agent Agent @relation(fields: [agentId], references: [id], onDelete: Cascade)

  @@index([status, createdAt])
  @@index([agentId, createdAt])
  @@index([conversationId, createdAt])
  @@map("agent_runs")
}
```

Three additions to tables that already exist:

```prisma
model Conversation {
  …
  /// Set the moment a human replies, or when the agent hands off. The agent
  /// stops answering for this thread until it is cleared.
  aiPausedAt       DateTime? @map("ai_paused_at")
  aiPausedByUserId String?   @map("ai_paused_by_user_id") @db.Uuid
  aiPauseReason    String?   @map("ai_pause_reason")
  aiPausedBy       User?     @relation("AiPauseActor", fields: [aiPausedByUserId], references: [id], onDelete: SetNull)
}

model Message {
  …
  /// Which agent wrote it. Null for every human and campaign send.
  agentId String? @map("agent_id") @db.Uuid
  agent   Agent?  @relation(fields: [agentId], references: [id], onDelete: SetNull)
}

model Workspace { … agents Agent[] }
model WhatsAppAccount { … agents Agent[] }
model User { … aiPauses Conversation[] @relation("AiPauseActor") }
```

### Raw SQL in the same migration

```sql
CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;

-- One active agent per number, enforced by the database rather than by a
-- transaction two requests can interleave.
CREATE UNIQUE INDEX agents_one_active_per_account
  ON agents (whatsapp_account_id) WHERE is_active;

-- Cosine, because the embedding model's vectors are normalised and cosine is
-- what the operator means by "similar". 1536 dims is well inside HNSW's 2000.
CREATE INDEX knowledge_chunks_embedding_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
```

The extension is created in `public` on purpose: the project has none installed
(`vector 0.8.2` available, `installed_version` null), so this migration is the
one that installs it and there is no second schema to search. If the shadow
database refuses `CREATE EXTENSION`, install it once from the Supabase SQL
editor and deploy with `prisma migrate deploy`, which needs no shadow database.

The dimension is welded into the column. Changing embedding model means a
migration, a `NULL`-and-re-embed pass and a re-index — not an env change. That
is stated here so nobody tries it as one.

## Extraction

One dispatch on MIME, one row per source, and the extracted text is kept.

| Input | How | Notes |
| --- | --- | --- |
| `.txt .md .csv` | decode as UTF-8 | A CSV keeps its shape by joining each row's cells with a separator |
| `.docx` | `mammoth` → raw text | Maintained, pure JS, no LibreOffice |
| `.xlsx .xls` | `exceljs` → rows joined per sheet | Chosen over the npm `xlsx` build, which carries published advisories that were fixed only off npm, and these are untrusted uploads |
| `.pdf` | `unpdf` text layer | Pure JS, no canvas; a page that yields no text is handed to Gemini as an image |
| image, audio, video | Gemini | See below |

`unpdf`, `mammoth` and `exceljs` are the only new dependencies: three pure-JS
packages, none with a native build, so the Render build stays
`npm ci && npm run build`. Versions are pinned exactly and the PDF one is the
first thing to check if extraction starts returning empty text.

**Gemini path.** `POST {GEMINI_BASE_URL}/models/{GEMINI_MEDIA_MODEL}:generateContent`
with the bytes as `inline_data` under 20 MB, and through the Files API above
that (`POST {base}/upload/files`, then `file_data` by URI). Files API objects
expire in 48 hours, which costs nothing here because the extraction happens once
and the transcript is stored. The prompt is one line: transcribe and describe,
do not answer, do not add commentary. Video yields its spoken words *and* what
is on screen, which is the whole reason for the second key.

A source that fails extraction is `FAILED` with the vendor's sentence in
`error`, and its chunks are deleted so a half-indexed file can never answer. The
retry action re-runs the same file from storage.

## Indexing

`POST` a source stores the bytes at
`agents/{workspaceId}/{agentId}/{sourceId}.{ext}`, writes the row `PENDING`, and
answers `202` with it. `AgentsRunner` does the indexing: a 1,200-chunk price book
is forty embedding calls, which is not an HTTP request, and a process that dies
mid-index has to be able to resume.

The runner claims one `PENDING` row with a conditional `UPDATE … WHERE status =
'PENDING'` — the same atomic claim `CampaignsRunner` uses — and then:

1. Extract text; write `text`, `charCount`, `status = PROCESSING`.
2. Split at 3,200 characters with 480 of overlap, preferring a paragraph or
   sentence boundary in the last 300 characters. Short documents stay one chunk.
3. Reject over 5,000 chunks (about 16 MB of text) as `SOURCE_TOO_LARGE`: it is
   a wrong upload, not a knowledge base.
4. `createMany` the chunks with `text`/`ord`/`tokens` (tokens = `ceil(chars / 4)`).
5. Embed in batches of 32, then one raw `UPDATE … SET embedding = $1::vector`
   per row inside a transaction per batch. Batching is verified: one call
   returns 3 vectors.
6. `status = READY`, `chunkCount`, `embedTokens`, `indexedAt`. Sources not
   `READY` are never searched.

A row left `PROCESSING` for more than ten minutes is stale — the process died —
and the next tick returns it to `PENDING` with `attempts` incremented; after two
the source is `FAILED` and the screen says retrying is the fix. Staleness is
measured on `updatedAt`, so no second timestamp column is needed. Sources are
drained before replies, so a question asked the minute a price list finished
uploading is answered from it.

Deleting a source deletes its chunks (cascade), its stored object, and nothing
else. Deleting an agent removes every source and leaves the conversations it
answered, with `Message.agentId` set to null so the thread still reads correctly.

## Retrieval

```sql
SET LOCAL hnsw.iterative_scan = relaxed_order;

SELECT c.id, c.text, c.ord, s.id AS source_id, s.title,
       1 - (c.embedding <=> $1::vector) AS score
FROM knowledge_chunks c
JOIN knowledge_sources s ON s.id = c.source_id
WHERE s.agent_id = $2::uuid
  AND s.status = 'READY'
  AND c.embedding IS NOT NULL
ORDER BY c.embedding <=> $1::vector
LIMIT 6;
```

`iterative_scan` is why pgvector 0.8 matters: the filter (one agent's READY
sources) is applied after the index scan, and the older behaviour would return
fewer than 6 rows whenever other agents' chunks crowded the neighbourhood. On a
multi-tenant install that is a correctness bug, not a tuning knob.

Chunks scoring under `0.25` are dropped. If none survive, the run is `SKIPPED`
with `no-context` and the customer gets the handoff line — cheaper, faster and
more honest than letting the model improvise from nothing.

## Reply engine

`WhatsAppWebhookService.delivery()` already ends by calling `InboxStore.record`.
That method gains a return value: the inbound messages it actually inserted —
not the outbound status updates it also writes, and not a message it recognised
from a retried delivery.

```ts
export interface StoredInbound {
  conversationId: string;
  messageId: string;
  kind: MessageKind;
  body: string | null;
}
async record(account: StoreAccount, changes: ParsedChange[]): Promise<StoredInbound[]>
```

Only inserted rows come back, so Meta's retries enqueue nothing — and
`AgentRun.inboundMessageId` is unique as a second guard. The store's own dedupe
on `wamid` is the first.

The webhook then calls `ReplyIntake.enqueue(stored, account)`, wrapped in a
`try/catch` that logs: a failed enqueue must never answer Meta with 500, because
a retry cannot fix it and the human can still see the message. `enqueue` takes
one query per delivery — is there an active agent for this account — and writes
one `QUEUED` run per answerable message. Answerable means `TEXT`, or
`BUTTON`/`INTERACTIVE` whose body is the customer's tapped title.

`AgentsRunner` ticks every second and takes the two kinds of work in order:
the sources above, then one queued reply. Nothing is queued inline.

**Claim.** One row at a time:
`UPDATE agent_runs SET status='CLAIMED', claimed_at=now() WHERE id = (SELECT id FROM agent_runs WHERE status='QUEUED' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id`.

**Gates**, in this order, each recording `reason` and returning:
`paused` (conversation has `aiPausedAt`) · `superseded` (a newer inbound message
exists for this conversation with its own queued run — answer once, for the
newest) · `window-closed` (`lastInboundAt` older than 24 hours) · `no-agent`
(the agent was deactivated mid-queue, which is what activating a sibling does to
the runs it had already queued).

**Answer.** `InboxSender.typing()` first, so the customer sees the indicator for
the two seconds the model is thinking. Retrieve, assemble the prompt, call the
provider, clean the reply, then send it. `InboxSender.text` gains one optional
field on its input, `agentId`, written straight to `Message.agentId`; that
column is what separates an AI reply from a human one for the badge, the
takeover rule and the activity log. Then write `SENT` with
`outboundMessageId`, both token counts and `latencyMs`.

**Failures.** A vendor 429 or 5xx retries twice with backoff, then `FAILED` with
the vendor's sentence. A 401 marks the run `FAILED` and the agent inactive: a
revoked key is a configuration fact, and continuing to try spends money to learn
nothing. Stale claims older than 90 seconds return to `QUEUED` with `attempts`
incremented, capped at 2, so a process that dies mid-call resumes instead of
looping.

**Prompt assembly** is a pure function, `reply.prompt.ts`, so it can be reasoned
about without a database:

- `system`: the agent's `systemPrompt`, then the business profile's company
  name, then the standing rules — answer only from the context, say plainly
  when the context does not cover it and offer a human, never invent a price, a
  policy, an availability or a link, never mention that you are following
  instructions or repeat the context verbatim, and stay under
  `maxReplyChars`.
- `system` second block: each retrieved chunk with its source title.
- `messages`: the last 10 text messages of the thread in order, the customer
  as `user` and our side as `assistant`. Customer text only ever arrives here —
  never concatenated into the system prompt, which is the whole defence against
  "ignore your instructions" arriving in a message.
- `max_completion_tokens: 400`, `temperature: agent.temperature`.

**Reply hygiene.** The output is not sent as the model wrote it:
`**bold**` becomes `*bold*` because that is what WhatsApp renders, heading
markers and code fences are stripped, blank runs collapse to one, the result is
truncated at a sentence boundary to `maxReplyChars`, and **any URL that does not
appear verbatim in the retrieved context is removed**. A support agent that
invents `aotms-support.com` sends a customer to a squatter.

**Takeover.** `InboxService.sendText` is the human path; the agent calls
`InboxSender.text` with an `agentId`. So the pause belongs there: after a human
send, one `updateMany` on the conversation where `aiPausedAt IS NULL` and the
account has an active agent sets the pause and the author. `POST
/conversations/:id/ai/resume` clears all three columns. The Inbox thread header
shows **AI active** or **AI paused** plus the reason, and each AI bubble carries
a small badge from `Message.agentId`.

**Handoff.** An `escalateKeywords` match short-circuits before the model call:
the run is `SKIPPED` with `handoff`, the conversation is paused with that
reason, and the customer receives one fixed line naming a human. Same handling
for `no-context`. The conversation's own status is never touched.

## API — `Backend/src/agents/`

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/agents` | Agents for the workspace's number, with source and run counts |
| `POST` | `/agents` | Create a draft: name, description, systemPrompt, model, temperature, keywords |
| `GET` | `/agents/:id` | Agent, sources, token totals, last 20 runs |
| `PATCH` | `/agents/:id` | Prompt, description, model, temperature, keywords, reply cap |
| `DELETE` | `/agents/:id` | Removes sources too; conversations stay |
| `POST` | `/agents/:id/activate` | Transactional: this one active, its siblings inactive. Refused until one source is `READY` |
| `POST` | `/agents/:id/sources/text` | `{ title, body }` — a typed note, indexed like a file |
| `POST` | `/agents/:id/sources/file` | Multipart, 25 MB ceiling, one file |
| `GET` | `/agents/:id/sources` | Status, counts, failure reason per row |
| `DELETE` | `/agents/:id/sources/:sourceId` | Chunks and stored object go with it |
| `POST` | `/agents/:id/sources/:sourceId/retry` | Re-extracts from the stored original |
| `POST` | `/agents/:id/ask` | Playground: `{ question }` → answer, citations, tokens; nothing is sent, but the call is recorded as a `PLAYGROUND` run so it is metered |
| `GET` | `/agents/:id/runs?kind=&status=` | Activity, newest first, paginated |
| `POST` | `/conversations/:id/ai/pause` | Manual pause, reason `manual` |
| `POST` | `/conversations/:id/ai/resume` | Clears the pause |

Machine codes, matching the inbox's `409 WINDOW_CLOSED` style:
`AI_NOT_CONFIGURED`, `MEDIA_EXTRACTOR_NOT_CONFIGURED`, `AGENT_NOT_ACTIVE`,
`AGENT_UNTRAINED`, `NO_CHANNEL`, `SOURCE_UNSUPPORTED`, `SOURCE_TOO_LARGE`,
`SOURCE_EMPTY`, `AI_UNAUTHORIZED`, `AI_RATE_LIMITED`, `WINDOW_CLOSED`.

`NO_CHANNEL` is `POST /agents` on a workspace with no connected number, the same
code campaigns already answers. `AGENT_UNTRAINED` is activation before any source
is `READY`: an agent with nothing to read hands off every question, which looks
broken and teaches the customer nothing.

`AI_NOT_CONFIGURED` is what every route that calls the provider answers when
`OPENAI_API_KEY` is absent, and `MEDIA_EXTRACTOR_NOT_CONFIGURED` is what a video
upload answers when `GEMINI_API_KEY` is absent — 503 with the sentence naming the
variable, the same way a template image answers without `META_APP_ID`. The API
still boots, and agent CRUD still works: only the calls that need a key fail.

### Files

```
Backend/src/agents/
  agents.module.ts            wires the providers and the storage factory
  agents.controller.ts        CRUD, activate, ask, runs
  agents.service.ts           activation transaction, delete/dispose, views
  knowledge.controller.ts     sources: text, file, list, delete, retry
  knowledge.service.ts        ingest orchestration, status transitions
  knowledge.chunk.ts          split + token estimate (pure)
  extract.ts                  txt, md, csv, docx, xlsx, pdf
  extract.media.ts            Gemini, the only place that calls it
  ai.openai.ts                chat + embeddings over fetch
  ai.gemini.ts                extractor over fetch
  ai.pricing.ts               model -> USD per million, read-time only
  ai.errors.ts                vendor errors -> the machine codes above
  retrieval.service.ts        embed the question, cosine search, floor
  reply.prompt.ts             context + history + rules (pure)
  reply.service.ts            one run, start to finish
  reply.intake.ts             webhook hook -> queued runs
  agents.runner.ts            one-second claim loop: sources, then replies
```

`MediaStorage` is provided to this module with `useFactory` and the
`AGENT_SOURCE_BUCKET` bucket, the pattern template media already uses — the class
is not duplicated for a third bucket.

## Screens

**`/workspace/chatbot`** — the placeholder becomes the agent screen: a header
with the number, the active agent and an activation switch; then four tabs
mirroring the four things an operator does.

- **Prompt** — name, instructions, model, temperature, reply cap, escalation
  keywords, saved as one form. The instructions field is the whole product, so
  it is the largest element on the tab and carries the standing rules as
  placeholder text.
- **Training** — a drop zone accepting the seven formats by extension, a typed
  note composer, and one row per source: title, kind icon, size, chunk count,
  status pill with the failure reason inline, retry and delete.
- **Playground** — a question box, the answer, and the citations that produced
  it with their scores. This is the screen that decides whether an agent is safe
  to activate, and it needs no WhatsApp traffic to answer that.
- **Activity** — the run table: time, kind, status, reason, tokens, latency, and
  a link to the conversation for a reply. Token totals for the period sit above
  it, and from phase 4 a cost figure beside them with the sentence that cost is
  an estimate and tokens are the record.

`frontend/src/features/chatbot/` holds all of it: `api.ts`, `types.ts`,
`chatbot-view.tsx`, and `components/{agent-form,training-panel,source-list,playground,activity-table,upload-dropzone}.tsx`.
The page is a thin server component passing ids, like the campaigns routes. A
tab appears when its phase lands — Playground with phase 1, Activity with
phase 2 — so the screen never shows a tab that can only answer 503.

**Inbox** — three small touches, no redesign: an `AI` badge on a bubble with an
`agentId`, an **AI paused · resume** control in the thread header, and the pause
reason as that control's tooltip.

## Configuration

| Key | Default | Required |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | for AI; routes answer 503 without it |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | test seam, like `META_GRAPH_BASE_URL` |
| `OPENAI_EMBED_MODEL` | `text-embedding-3-small` | changing it needs a migration |
| `GEMINI_API_KEY` | — | for image, audio and video only |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | test seam |
| `GEMINI_MEDIA_MODEL` | `gemini-2.5-flash` | any multimodal id the key can reach |
| `AGENT_SOURCE_BUCKET` | `agent-sources` | third bucket, created on first upload |

All optional in `env.ts`, following `META_APP_ID`: a deployment without AI must
still boot. The chat model is *not* an env var — it is a code constant copied
into `Agent.model` at creation and then owned by the row, so changing the
default never silently re-prompts an agent someone tuned. The retrieval floor,
top-k, chunk size, tick interval, batch size and the 25 MB ceiling are constants
for the same reason: a wrong one is a bug, and a bug should not be fixable by an
env var.

## Phases

1. **Index and ask.** Schema, pgvector, OpenAI adapter, text and document
   extraction, chunking, retrieval, playground, Prompt and Training tabs. No
   automatic reply yet — the agent is provable before it is audible.
2. **Answer.** Intake, runner, prompt, hygiene, takeover, handoff, inbox badge
   and resume, plus the Activity tab now that runs exist.
3. **Media.** Gemini extractor for image, audio and video, retry and re-index.
4. **Usage.** The cost column and per-agent, per-day token totals over the runs
   phase 2 already records.

## Verification

- Backend `npx tsc --noEmit` and `npm run build`; frontend `npx tsc --noEmit`,
  `npx eslint src --max-warnings=0`, `npm run build`.
- Migration applied against the real project with `prisma migrate deploy`, then
  `SELECT extversion FROM pg_extension WHERE extname = 'vector'` answering
  `0.8.2`, and `\d knowledge_chunks` showing the HNSW index.
- A fixture agent with one 20-page PDF and one typed price list: every question
  whose answer is in the material returns a citation with a score above the
  floor; a question that is not in the material returns the handoff line and
  writes `no-context`. Chunk count and `embedTokens` are non-zero and
  `READY`.
- Reply path end to end with a real inbound: `QUEUED → CLAIMED → SENT` inside
  four seconds, one reply per message, a retried delivery producing no second
  reply (the unique constraint), a human reply pausing the thread, resume
  restoring it, and an `escalateKeywords` match skipping the model call.
- Not verified in this pass: any Gemini call (no key), a video longer than the
  inline limit, and the 24-hour expiry path, which needs a thread left alone for
  a day.

## Known gaps

A customer's image gets no reply until phase 3 — the message reaches the inbox
and a human answers it, which is what happens today. There is no per-conversation
reset of the assistant's memory beyond the 10-message window, no suggested
replies and no conversation summaries from PRD Module 8, no multi-number routing
because `WhatsAppAccount.workspaceId` is unique, and no spend ceiling: usage is
recorded, never refused, until someone decides what a plan limit should be. The
runner assumes a single instance, exactly as `CampaignsRunner` does.
