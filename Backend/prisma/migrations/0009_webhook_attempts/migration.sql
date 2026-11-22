-- The handshake trace: one row per GET Meta sends to the webhook endpoint.
-- Kept independent of `whatsapp_accounts` on purpose: a rejected call has no
-- workspace to belong to, and the evidence must survive a disconnect.

CREATE TABLE "webhook_attempts" (
    "id" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" TEXT,
    "token_hint" TEXT,
    "matched_account_id" UUID,
    "ip" TEXT,

    CONSTRAINT "webhook_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_attempts_at_idx" ON "webhook_attempts"("at");
CREATE INDEX "webhook_attempts_matched_account_id_idx" ON "webhook_attempts"("matched_account_id");
