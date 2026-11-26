-- Hiding one message is local only: WhatsApp's Cloud API has no revoke
-- endpoint, so the bubble disappears from this inbox while the customer keeps
-- the message. The row itself survives — `wamid` is the dedupe key for retried
-- deliveries and campaign/analytics history points at it — so a hidden message
-- is a timestamp, not a deletion.

ALTER TABLE "messages"
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by_user_id" UUID;
