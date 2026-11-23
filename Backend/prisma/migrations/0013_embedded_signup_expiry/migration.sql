-- Embedded Signup: remember when the business token lapses.
ALTER TABLE "whatsapp_accounts"
  ADD COLUMN "token_expires_at" TIMESTAMP(3);
