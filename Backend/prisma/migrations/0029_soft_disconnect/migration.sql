-- Disconnect used to delete the account row, and `conversations.account_id`
-- cascades, so every thread, message, note and follow-up went with it. A
-- customer who reconnected the same number got a fresh row and an empty inbox.
--
-- Soft disconnect keeps the row and erases only what must not survive: the
-- access token, the verify token and the app secret. `phone_number_id` stays
-- unique and unchanged, so the connect path's upsert revives this same row and
-- the existing conversations re-attach to it by id. The row is left with no
-- usable secret, which is the guarantee disconnect actually owes the customer.
--
-- Hand-written because this repository authors migrations as SQL and applies
-- them with `prisma migrate deploy` (never `migrate dev` or `db push`).
--
-- `ADD VALUE` is legal inside the transaction `migrate deploy` opens on
-- Postgres 12+ as long as that transaction does not use the new label; this one
-- does not. Dropping NOT NULL is metadata-only, so no table is rewritten.

ALTER TYPE "WhatsAppStatus" ADD VALUE IF NOT EXISTS 'DISCONNECTED';

ALTER TABLE "whatsapp_accounts"
    ALTER COLUMN "access_token_cipher" DROP NOT NULL,
    ALTER COLUMN "verify_token_cipher" DROP NOT NULL,
    ADD COLUMN "disconnected_at" TIMESTAMP(3);