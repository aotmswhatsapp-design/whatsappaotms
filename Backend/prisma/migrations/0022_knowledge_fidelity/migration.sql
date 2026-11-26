-- Additive only. Existing rows keep NULL in every new column, and
-- `extract_tokens` takes the fast default path (Postgres 11+), so no rewrite.
ALTER TABLE "knowledge_sources"
  ADD COLUMN     "sha256" CHAR(64),
  ADD COLUMN     "uploaded_by_user_id" UUID,
  ADD COLUMN     "replaces_source_id" UUID,
  ADD COLUMN     "meta" JSONB,
  ADD COLUMN     "extract_tokens" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "knowledge_chunks"
  ADD COLUMN "page" INTEGER,
  ADD COLUMN "sheet" TEXT,
  ADD COLUMN "row_from" INTEGER,
  ADD COLUMN "row_to" INTEGER,
  ADD COLUMN "heading" TEXT;

-- Names match what Prisma emits for @@unique / @@index, so `prisma migrate dev`
-- sees no drift. NULLs are distinct, so typed notes never collide.
CREATE UNIQUE INDEX "knowledge_sources_agent_id_sha256_key"
  ON "knowledge_sources" ("agent_id", "sha256");

CREATE INDEX "knowledge_sources_replaces_source_id_idx"
  ON "knowledge_sources" ("replaces_source_id");
