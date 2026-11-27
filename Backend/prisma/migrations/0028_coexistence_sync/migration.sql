-- The 24-hour coexistence obligation: what Meta was asked for, what it
-- answered, and whether the history has finished arriving.
--
-- Hand-written because this repository authors migrations as SQL and applies
-- them with `prisma migrate deploy` (never `migrate dev` or `db push`).
--
-- `ADD COLUMN ... DEFAULT false` is metadata-only on Postgres 11+, so the
-- messages table is not rewritten. `ADD VALUE` is legal inside the transaction
-- `migrate deploy` opens on Postgres 12+ as long as that transaction does not
-- use the new label; this one does not.

ALTER TABLE "whatsapp_accounts"
    ADD COLUMN "on_biz_app" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "state_sync_at" TIMESTAMP(3),
    ADD COLUMN "state_sync_request_id" TEXT,
    ADD COLUMN "history_sync_at" TIMESTAMP(3),
    ADD COLUMN "history_sync_request_id" TEXT,
    ADD COLUMN "history_sync_done_at" TIMESTAMP(3),
    ADD COLUMN "history_sync_error" TEXT;

ALTER TABLE "messages"
    ADD COLUMN "imported" BOOLEAN NOT NULL DEFAULT false;

ALTER TYPE "MessageKind" ADD VALUE IF NOT EXISTS 'MEDIA_PENDING';