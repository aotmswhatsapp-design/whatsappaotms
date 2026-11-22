-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "campaign_id" UUID;

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "template_id" UUID NOT NULL,
    "template_name" TEXT NOT NULL,
    "template_language" TEXT NOT NULL,
    "template_category" "TemplateCategory" NOT NULL,
    "audience_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "variables" JSONB NOT NULL DEFAULT '{}',
    "button_urls" JSONB NOT NULL DEFAULT '{}',
    "opt_in_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "wa_id" TEXT NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "message_id" UUID,
    "error_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaigns_workspace_id_created_at_idx" ON "campaigns"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "campaigns_status_scheduled_at_idx" ON "campaigns"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_message_id_key" ON "campaign_recipients"("message_id");

-- CreateIndex
CREATE INDEX "campaign_recipients_campaign_id_status_idx" ON "campaign_recipients"("campaign_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaign_id_contact_id_key" ON "campaign_recipients"("campaign_id", "contact_id");

-- CreateIndex
CREATE INDEX "messages_campaign_id_idx" ON "messages"("campaign_id");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "message_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

