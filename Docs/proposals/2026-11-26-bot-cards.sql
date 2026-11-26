-- PROPOSAL — NOT APPLIED AND NOT IN prisma/migrations/.
--
-- Phase 3 can send a card and route what comes back, but it cannot store one.
-- `InboxSender.interactive` writes the card it sent into `messages.payload`,
-- which is exactly what a tap needs: the card the customer saw, not the card the
-- business has since edited. What is missing is the editable card itself — the
-- thing a business authors once and every send copies.
--
-- `Agent` has no JSON column and no child table for this, so a card cannot live
-- anywhere without a table. Until this is approved nothing is lost:
-- `bot.render` works from a `BotCard` value, so a card can be built in code,
-- sent, and routed. What cannot be done is authoring one in the dashboard and
-- having it survive a restart.
--
-- WHEN APPROVED, this becomes `Backend/prisma/migrations/0025_bot_cards/migration.sql`
-- and the model below joins `schema.prisma`.
--
-- 0025, not 0024: the comment on 0023_knowledge_lease_token/migration.sql
-- already reserves 0024 for a later column drop.

-- ---------------------------------------------------------------------------
-- 1. The Prisma model (as it would read in schema.prisma)
-- ---------------------------------------------------------------------------
-- One card of an agent's flow: a picture, some information, and the buttons that
-- follow them. A flow is every card of one agent plus the single card marked
-- root — there is no `bot_flows` table, because a flow never spans two agents
-- and `Agent` is already bound to exactly one number.
--
--   /// One card an agent sends. A flow is every card of one agent, plus the
--   /// single one marked root.
--   model BotCard {
--     id        String   @id @default(uuid()) @db.Uuid
--     agentId   String   @map("agent_id") @db.Uuid
--     title     String
--     /// The picture shown in the header. Null means the title is the header.
--     imageUrl  String?  @map("image_url")
--     /// What the customer reads. Authored, never generated.
--     info      String   @default("")
--     /// `BotButton[]` as bot.card.ts defines it: [{ id, label, action }].
--     /// Read and written whole and in order, so it is JSON, not a second table.
--     buttons   Json     @default("[]")
--     isRoot    Boolean  @default(false) @map("is_root")
--     createdAt DateTime @default(now()) @map("created_at")
--     updatedAt DateTime @updatedAt @map("updated_at")
--
--     agent Agent @relation(fields: [agentId], references: [id], onDelete: Cascade)
--
--     @@index([agentId, createdAt])
--     @@map("bot_cards")
--   }
--
-- and, on `Agent`, one line beside `sources KnowledgeSource[]`:
--
--   cards BotCard[]

-- ---------------------------------------------------------------------------
-- 2. The migration
-- ---------------------------------------------------------------------------
-- `updated_at` carries no default because Prisma writes it on every update; a
-- row inserted outside the client would need it supplied, which is the same
-- contract `agents` already has.
CREATE TABLE "bot_cards" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "image_url" TEXT,
    "info" TEXT NOT NULL DEFAULT '',
    "buttons" JSONB NOT NULL DEFAULT '[]',
    "is_root" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_cards_pkey" PRIMARY KEY ("id")
);

-- The read the dashboard makes: this agent's cards, oldest first.
CREATE INDEX "bot_cards_agent_id_created_at_idx" ON "bot_cards"("agent_id", "created_at");

-- Deleting an agent deletes its cards. A card the customer was already sent is
-- unaffected: that copy lives in `messages.payload`.
ALTER TABLE "bot_cards"
    ADD CONSTRAINT "bot_cards_agent_id_fkey"
    FOREIGN KEY ("agent_id") REFERENCES "agents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. What is deliberately not here
-- ---------------------------------------------------------------------------
-- No partial unique index on `(agent_id) WHERE is_root`. It would be the
-- database's job to keep one root per agent, but Prisma cannot express a partial
-- index in `schema.prisma`, and the next `migrate dev` would read it as an index
-- nobody declared and generate a DROP for it. The invariant lives in the write
-- path instead: setting a card root clears the previous root in the same
-- transaction. Two roots would then need a bug, not a race.
--
-- No table for the buttons. They are read and written with the card, always in
-- full, and a normalised `bot_buttons` table would cost a second read per send
-- plus an ordering column to reproduce an order JSON already has. The cost is
-- that `action.cardId` is not a foreign key: deleting a card leaves a dangling
-- action, which `targetOf()` turns into "that branch is gone" rather than an
-- error. If cards ever grow conditional visibility or per-button analytics, the
-- buttons become a table and this trade-off reverses.
--
-- No enum change. `MessageKind` has carried `BUTTON` and `INTERACTIVE` since
-- 0004, and `messages.payload` already holds the card snapshot Phase 3 writes.
--
-- No length limits in SQL. The 20- and 24-character cuts in `bot.render` are
-- applied to what is sent; a stored label that is longer is not corrupt — it is
-- a label, and `fit()` shortens it at send time.

-- ---------------------------------------------------------------------------
-- 4. Verification, after applying
-- ---------------------------------------------------------------------------
--   SELECT count(*) FROM bot_cards;
--   \d+ bot_cards
--
-- and, from the application, one round trip through the client — Prisma's JSON
-- mapping is the only part of this table a query alone will not exercise:
--
--   const card = await prisma.botCard.create({ data: { agentId,
--     title: 'Breakfast', info: 'Dosa 80.', isRoot: true,
--     buttons: [{ id: 'b-drinks', label: 'Drinks',
--                 action: { kind: 'card', cardId: 'c-drinks' } }] } });
--   // read it back and assert deep equality on `buttons`

-- ---------------------------------------------------------------------------
-- 5. Rollback
-- ---------------------------------------------------------------------------
-- Cards the customer was sent survive: they are snapshots in `messages.payload`,
-- so a tap still routes against what was on screen. Only the editability is
-- lost, which is what this table added.
--
-- DROP TABLE IF EXISTS "bot_cards";
