-- CreateEnum
CREATE TYPE "WhatsAppSource" AS ENUM ('MANUAL', 'EMBEDDED_SIGNUP');

-- AlterTable
-- Existing rows were typed in by hand, so MANUAL is the honest default.
ALTER TABLE "whatsapp_accounts"
ADD COLUMN "source" "WhatsAppSource" NOT NULL DEFAULT 'MANUAL';
