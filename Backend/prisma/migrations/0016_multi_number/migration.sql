-- A workspace may connect more than one WhatsApp number.
--
-- Until this migration `whatsapp_accounts.workspace_id` was unique, so every
-- read could be `findUnique({ where: { workspaceId } })` and a reconnect
-- replaced the workspace's only row. Both shortcuts go away: the row is keyed
-- by the pair Meta actually names in a delivery, and the number a reader means
-- when it names none is the one marked `is_default`.

-- 1. Drop the one-number-per-workspace rule. It is an index rather than a
--    table constraint — `0004_inbox` created it with CREATE UNIQUE INDEX, which
--    is how Prisma emits a single-column `@unique` on Postgres.
DROP INDEX "whatsapp_accounts_workspace_id_key";

-- 2. The real key. Reconnecting to a number updates its row; a second number
--    adds one instead of displacing the first.
CREATE UNIQUE INDEX "whatsapp_accounts_workspace_id_phone_number_id_key"
  ON "whatsapp_accounts"("workspace_id", "phone_number_id");

-- 3. Lookups that used the old unique index now filter by workspace.
CREATE INDEX "whatsapp_accounts_workspace_id_idx"
  ON "whatsapp_accounts"("workspace_id");

-- 4. The label, and the default-account marker.
ALTER TABLE "whatsapp_accounts" ADD COLUMN "label" TEXT;
ALTER TABLE "whatsapp_accounts" ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;

-- 5. Backfill. The constraint dropped in step 1 held until now, so no workspace
--    has more than one row: marking every row true gives each workspace exactly
--    one default, and every existing reader resolves to the same row it did
--    before this migration.
UPDATE "whatsapp_accounts" SET "is_default" = true;

-- 6. At most one default per workspace, enforced here rather than in the
--    service — the same pattern as `agents_one_active_per_account`. A partial
--    index keeps the many non-default numbers out of the constraint.
CREATE UNIQUE INDEX "whatsapp_accounts_one_default_per_workspace"
  ON "whatsapp_accounts"("workspace_id") WHERE "is_default";

-- 7. A campaign remembers which number ran it. Plain column, no foreign key:
--    disconnecting a number must not erase the campaigns it ran, the same rule
--    `template_daily_stats` follows. Existing rows stay null and resolve to the
--    workspace's default number.
ALTER TABLE "campaigns" ADD COLUMN "whatsapp_account_id" UUID;
