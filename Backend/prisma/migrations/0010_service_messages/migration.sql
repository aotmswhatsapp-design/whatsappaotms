-- Service-message parity with Meta's Messages API.
--
-- `context_wamid` stores quotes in BOTH directions: the `context.id` Meta sends
-- when a customer replies to something, and the row an agent answered. Without
-- it a reply chain reads as disconnected messages. `payload` carries the kinds
-- that are neither text nor a file — a location's coordinates, a contact card's
-- fields — so their bubbles can render instead of showing a generic label.
--
-- REACTION is a real message kind: one emoji on another message, with
-- `context_wamid` naming the target. Meta keeps one reaction per sender per
-- message, so the thread shows the latest rather than a growing list.

-- AlterEnum
ALTER TYPE "MessageKind" ADD VALUE 'REACTION';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "context_wamid" TEXT,
ADD COLUMN     "payload" JSONB;

-- CreateIndex
CREATE INDEX "messages_context_wamid_idx" ON "messages"("context_wamid");
