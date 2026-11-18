-- AlterTable
ALTER TABLE "whatsapp_accounts"
ADD COLUMN "app_secret_cipher" TEXT,
ADD COLUMN "webhook_verified_at" TIMESTAMP(3),
ADD COLUMN "last_event_at" TIMESTAMP(3),
ADD COLUMN "event_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "last_check_at" TIMESTAMP(3),
ADD COLUMN "failure_reason" TEXT;

-- CreateIndex
-- Meta identifies the account by phone_number_id on every delivery.
CREATE INDEX "whatsapp_accounts_phone_number_id_idx" ON "whatsapp_accounts"("phone_number_id");
