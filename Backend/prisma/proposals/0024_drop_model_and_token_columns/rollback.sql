-- ROLLBACK for 0024_drop_model_and_token_columns. Every column returns with the
-- default it was created with, so this SQL runs against a populated table.
--
-- What it cannot restore is the data the drop deleted. Counters come back as 0,
-- which is the truthful value for a run that spent nothing; `system_prompt`
-- comes back empty, and any prompt a customer had written is gone. There is no
-- way to reconstruct embeddings either — but nothing reads them any more, so a
-- rollback only needs the vector build if the AI code is being restored too.

ALTER TABLE "agents"
  ADD COLUMN "system_prompt" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "model"         TEXT NOT NULL DEFAULT 'gpt-5.4-mini',
  ADD COLUMN "temperature"   DOUBLE PRECISION NOT NULL DEFAULT 0.4;

-- The prompt column was created without a default; keep it that way so a new
-- row cannot be inserted with a silently empty prompt.
ALTER TABLE "agents"
  ALTER COLUMN "system_prompt" DROP DEFAULT;

ALTER TABLE "knowledge_sources"
  ADD COLUMN "embed_tokens"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "extract_tokens" INTEGER NOT NULL DEFAULT 0;

CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;

ALTER TABLE "knowledge_chunks"
  ADD COLUMN "embedding" vector(1536);

CREATE INDEX "knowledge_chunks_embedding_idx"
ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "agent_runs"
  ADD COLUMN "tokens_in"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tokens_out"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "embedding_tokens" INTEGER NOT NULL DEFAULT 0;
