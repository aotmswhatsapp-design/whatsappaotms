-- One agent owns one conversation.
--
-- Two agents can live on the same number, but they must never take turns
-- inside one thread: the customer would see two voices, and each agent's
-- history would be half a conversation. The owner is written on the first
-- inbound message and kept until the agent it names is gone or switched off.
--
-- Existing rows stay null rather than being backfilled: null means "nobody has
-- answered this thread yet", and the next inbound message binds it. Writing a
-- guess here would claim those threads were always owned.

ALTER TABLE "conversations" ADD COLUMN "agent_id" UUID;

CREATE INDEX "conversations_agent_id_idx" ON "conversations"("agent_id");

-- SET NULL, not CASCADE: deleting an agent must not delete the conversations
-- it took, and the freed thread is bound again on its next message.
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
