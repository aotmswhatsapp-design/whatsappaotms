-- One interactive flow per agent: the cards a customer walks through, stored as
-- the same JSONB the renderer and the tap router already read.
--
-- The row is keyed by agent rather than by flow: an agent has exactly one flow,
-- so `agent_id` carries a unique index and the service's save is an upsert.
-- The payload is not normalised into card and button tables on purpose -- a
-- flow is validated as a whole (`flowProblem`), and a card is never read on its
-- own.

-- CreateTable
CREATE TABLE "bot_flows" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
