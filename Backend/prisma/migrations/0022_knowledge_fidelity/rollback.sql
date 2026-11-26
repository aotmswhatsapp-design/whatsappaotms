-- Documentation only. Never auto-run: roll code back first, because the
-- previous release ignores every column added above.
DROP INDEX IF EXISTS "knowledge_sources_replaces_source_id_idx";
DROP INDEX IF EXISTS "knowledge_sources_agent_id_sha256_key";
ALTER TABLE "knowledge_chunks"
  DROP COLUMN IF EXISTS "page",
  DROP COLUMN IF EXISTS "sheet",
  DROP COLUMN IF EXISTS "row_from",
  DROP COLUMN IF EXISTS "row_to",
  DROP COLUMN IF EXISTS "heading";
ALTER TABLE "knowledge_sources"
  DROP COLUMN IF EXISTS "sha256",
  DROP COLUMN IF EXISTS "uploaded_by_user_id",
  DROP COLUMN IF EXISTS "replaces_source_id",
  DROP COLUMN IF EXISTS "meta",
  DROP COLUMN IF EXISTS "extract_tokens";
