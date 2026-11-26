-- One interactive flow per agent: the cards a customer walks through, stored as
-- the same JSON the renderer and the tap router already read.
--
-- The row is keyed by agent rather than by flow: an agent has exactly one flow,
-- so `agent_id` carries a unique index and the service's save is an upsert.
-- The payload is not normalised into card and button tables on purpose -- a
-- flow is validated as a whole (`flowProblem`), and a card is never read on its
-- own.
--
-- Additive only: one new table, no existing table is touched, and nothing reads
-- it until this migration has run -- `BotStore` answers 503 BOT_STORE_MISSING
-- against a database without the table rather than failing as a bug.
--
-- Undoing this is a later forward migration that drops the table; there is no
-- rollback file, because a migration that has run is history.
--
-- Numbered 0025 because 0024 is reserved for `0024_drop_model_and_token_columns`
-- (docs/proposals), which has not been approved.

-- CreateTable
CREATE TABLE "bot_flows" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_flows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One flow per agent. This is what makes the save an upsert.
CREATE UNIQUE INDEX "bot_flows_agent_id_key" ON "bot_flows"("agent_id");

-- CreateIndex
-- The list a workspace screen would need; cheap next to the unique index.
CREATE INDEX "bot_flows_workspace_id_idx" ON "bot_flows"("workspace_id");

-- AddForeignKey
-- Deleting an agent deletes its flow: a flow with no agent has no reader.
ALTER TABLE "bot_flows"
  ADD CONSTRAINT "bot_flows_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_flows"
  ADD CONSTRAINT "bot_flows_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
