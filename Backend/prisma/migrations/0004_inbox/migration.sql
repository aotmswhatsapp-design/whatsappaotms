-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'STICKER', 'LOCATION', 'CONTACTS', 'BUTTON', 'INTERACTIVE', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- DropIndex
DROP INDEX "whatsapp_accounts_user_id_key";

-- AlterTable
--
-- Added nullable on purpose: a live row has no workspace yet. The backfill below
-- gives every existing account one, reusing the owner's membership when it
-- exists, and only then does the column become required. Rendering this as a
-- single NOT NULL add would fail on any database that already has a connection.
ALTER TABLE "whatsapp_accounts" ADD COLUMN "workspace_id" UUID;

DO $$
DECLARE
  account RECORD;
  tenant UUID;
BEGIN
  FOR account IN SELECT "id", "user_id" FROM "whatsapp_accounts" LOOP
    SELECT "workspace_id" INTO tenant
    FROM "workspace_members"
    WHERE "user_id" = account."user_id"
    ORDER BY "created_at" ASC
    LIMIT 1;

    IF tenant IS NULL THEN
      INSERT INTO "workspaces" ("id", "name", "slug", "plan", "owner_id", "created_at", "updated_at")
      SELECT gen_random_uuid(),
             COALESCE(NULLIF(u."full_name", ''), split_part(u."email", '@', 1), 'Workspace'),
             'ws-' || substr(replace(u."id"::text, '-', ''), 1, 12),
             'STARTER',
             u."id",
             now(),
             now()
      FROM "users" u
      WHERE u."id" = account."user_id"
      RETURNING "id" INTO tenant;

      INSERT INTO "workspace_members" ("workspace_id", "user_id", "role", "created_at")
      VALUES (tenant, account."user_id", 'OWNER', now())
      ON CONFLICT DO NOTHING;
    END IF;

    UPDATE "whatsapp_accounts" SET "workspace_id" = tenant WHERE "id" = account."id";
  END LOOP;
END $$;

ALTER TABLE "whatsapp_accounts" ALTER COLUMN "workspace_id" SET NOT NULL;

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "wa_id" TEXT NOT NULL,
    "profile_name" TEXT,
    "phone_display" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to_user_id" UUID,
    "last_inbound_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_preview" TEXT,
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "kind" "MessageKind" NOT NULL DEFAULT 'TEXT',
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "wamid" TEXT,
    "body" TEXT,
    "media_id" TEXT,
    "media_mime" TEXT,
    "media_name" TEXT,
    "media_size" INTEGER,
    "media_sha256" TEXT,
    "media_path" TEXT,
    "error_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_notes" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_workspace_id_last_seen_at_idx" ON "contacts"("workspace_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_workspace_id_wa_id_key" ON "contacts"("workspace_id", "wa_id");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_last_message_at_idx" ON "conversations"("workspace_id", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_status_last_message_at_idx" ON "conversations"("workspace_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_assigned_to_user_id_idx" ON "conversations"("assigned_to_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_account_id_contact_id_key" ON "conversations"("account_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_wamid_key" ON "messages"("wamid");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_workspace_id_created_at_idx" ON "messages"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_notes_conversation_id_created_at_idx" ON "internal_notes"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_workspace_id_key" ON "whatsapp_accounts"("workspace_id");

-- AddForeignKey
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

