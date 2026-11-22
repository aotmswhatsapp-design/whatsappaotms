-- The app id that issued each connection's access token. Template image
-- uploads are addressed by app id and Meta rejects a token minted by another
-- app, so the value has to travel with the connection.
ALTER TABLE "whatsapp_accounts" ADD COLUMN "app_id" TEXT;

-- Stamped when per-template insights were switched on for the WABA. Meta's
-- switch is one-way, so this is the record that it was asked for.
ALTER TABLE "whatsapp_accounts" ADD COLUMN "insights_enabled_at" TIMESTAMP(3);
