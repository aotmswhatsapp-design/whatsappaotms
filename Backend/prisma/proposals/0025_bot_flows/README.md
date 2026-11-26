# Proposal 0025 — the chatbot flow table

**Status: NOT APPLIED.** This directory sits outside `prisma/migrations/`, so
`prisma migrate deploy` cannot see it. `schema.prisma` is deliberately unchanged.

Unlike proposal 0024, the code that uses this table is already merged. It does
not wait for the migration to compile: `BotStore` binds two raw statements
(`$queryRaw` / `$executeRaw`), and a database without the table answers
`503 BOT_STORE_MISSING` with the name of this file. Apply the migration and the
editor at `/workspace/chatbot` works with no further change.

## Why

The Chatbot screen was a placeholder. The card model, the WhatsApp renderer, the
tap parser and the action router all existed (`src/bots/bot.card.ts`,
`bot.render.ts`, `bot.tap.ts`, `bot.route.ts`), but nothing let an owner write a
flow down, so the Inbox had cards to send only if a developer wrote them by
hand.

One flow per agent, authored by the owner, sent into a conversation from the
Inbox. That is the smallest thing that makes the screen do something real, and
it needs one table.

## Table

```sql
CREATE TABLE "bot_flows" (
    "id"           UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "agent_id"     UUID NOT NULL,
    "data"         JSONB NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bot_flows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_flows_agent_id_key" ON "bot_flows"("agent_id");
CREATE INDEX "bot_flows_workspace_id_idx" ON "bot_flows"("workspace_id");
```

Both foreign keys cascade. Deleting an agent deletes its flow; a flow with no
agent has no reader.

The payload is JSONB rather than `bot_cards` / `bot_buttons` tables because a
flow is validated as a whole: an entry card that exists, a button that points
inside the flow, no card that only opens itself (`flowProblem`). A per-card row
model would let the database hold a flow that no validation ever accepted.

## Prisma model diff (what `schema.prisma` gains)

```prisma
model BotFlow {
  id          String   @id @default(uuid()) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  agentId     String   @unique @map("agent_id") @db.Uuid
  /// The cards, in the shape `flowProblem` validated on write.
  data        Json
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  agent     Agent     @relation(fields: [agentId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
  @@map("bot_flows")
}
```

Plus the back-relations: `botFlow BotFlow?` on `Workspace` and on `Agent`.

## Code edits that must land in the same change

None are required for the feature to work. These are the follow-up that removes
the raw SQL once the table is real:

1. Add the model above and the two back-relations.
2. Replace `BotStore`'s two statements with `this.prisma.botFlow.findUnique({ where: { agentId } })` and `this.prisma.botFlow.upsert(...)`. The reader (`flowIn`) stays — the column is still `Json`, and a row written by an older build is still untrusted input.
3. `BotStore.missingTable` and the `503 BOT_STORE_MISSING` branch in `BotsService.guard` become dead; delete both, and the test that asserts the 503.

## What it costs to be wrong

- The table holds nothing but what the editor wrote, and nothing else reads it.
  Dropping it loses the flows — `rollback.sql` says how to copy them out first —
  and the editor falls back to the install instruction.
- If the table is applied and then the feature is abandoned, it is one empty
  table with no writer and no reader. No customer-visible state depends on it.

## Rollback

`rollback.sql` in this directory: drops the two indexes and the table.
