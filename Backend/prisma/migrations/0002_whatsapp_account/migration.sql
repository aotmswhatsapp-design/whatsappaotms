-- CreateEnum
CREATE TYPE "WhatsAppStatus" AS ENUM ('VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "whatsapp_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "business_account_id" TEXT NOT NULL,
    "graph_version" TEXT NOT NULL,
    "display_phone_number" TEXT,
    "verified_name" TEXT,
    "quality_rating" TEXT,
    "business_name" TEXT,
    "status" "WhatsAppStatus" NOT NULL DEFAULT 'VERIFIED',
    "last_verified_at" TIMESTAMP(3),
    "access_token_cipher" TEXT NOT NULL,
    "verify_token_cipher" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_user_id_key" ON "whatsapp_accounts"("user_id");

-- AddForeignKey
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

