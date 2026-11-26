-- PROPOSAL — NOT APPLIED. Nothing in `prisma/migrations` references this file.
--
-- Every column below is now written by nothing and read by nothing. Each was
-- left in place, with its existing default, when the code stopped writing it,
-- which is why dropping them is a clean additive-in-reverse: no row has to be
-- rewritten to satisfy a NOT NULL, and no other table points at them.
--
-- To apply: move this directory into `prisma/migrations/0024_drop_model_and_token_columns/`
-- with its `migration.sql`, land the code edits listed in README.md in the same
-- change, and run `prisma migrate deploy`. `prisma migrate dev` is not used here.

-- The answer is composed locally from retrieved text. There is no model to name
-- and no sampling temperature to set.
ALTER TABLE "agents"
  DROP COLUMN "model",
  DROP COLUMN "temperature",
  -- Inert since the prompt composer was deleted: `create` still writes
  -- DEFAULT_PROMPT into it and nothing ever reads it back.
  DROP COLUMN "system_prompt";

-- Per-source spend, for two readers that no longer exist: embeddings (the
-- engine is Postgres full text) and image/audio extraction (refused at upload).
ALTER TABLE "knowledge_sources"
  DROP COLUMN "embed_tokens",
  DROP COLUMN "extract_tokens";

-- Derived data only: `knowledge_chunks.text` and `knowledge_sources.text` are
-- untouched, so a re-index is still possible from the stored text. Dropping the
-- column drops its HNSW index with it.
DROP INDEX IF EXISTS "knowledge_chunks_embedding_idx";
ALTER TABLE "knowledge_chunks"
  DROP COLUMN "embedding";

-- Token accounting for calls that are no longer made. `latency_ms` stays: it is
-- still measured, and it is now the only cost a run has.
ALTER TABLE "agent_runs"
  DROP COLUMN "tokens_in",
  DROP COLUMN "tokens_out",
  DROP COLUMN "embedding_tokens";

-- The extension stays installed. Nothing uses it, but dropping an extension is
-- a server-wide decision with other tenants in the same database; it belongs in
-- its own proposal, not this one.
