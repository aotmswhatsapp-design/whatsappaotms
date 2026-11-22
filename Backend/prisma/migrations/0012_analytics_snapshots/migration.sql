-- CreateEnum
CREATE TYPE "CostStatus" AS ENUM ('ACTUAL', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "AnalyticsSource" AS ENUM ('META');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'OK', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "whatsapp_accounts" ADD COLUMN     "currency" TEXT;

-- CreateTable
CREATE TABLE "template_daily_stats" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "whatsapp_account_id" UUID NOT NULL,
    "waba_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "message_template_id" UUID,
    "template_name" TEXT NOT NULL,
    "category" TEXT,
    "date" DATE NOT NULL,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "read_count" INTEGER NOT NULL DEFAULT 0,
    "clicked_count" INTEGER NOT NULL DEFAULT 0,
    "amount_spent" DECIMAL(18,6),
    "cost_per_delivered" DECIMAL(18,6),
    "cost_per_url_click" DECIMAL(18,6),
    "currency" TEXT,
    "cost_status" "CostStatus" NOT NULL DEFAULT 'UNAVAILABLE',
    "source" "AnalyticsSource" NOT NULL DEFAULT 'META',
    "last_synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_daily_stats" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "whatsapp_account_id" UUID NOT NULL,
    "waba_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "phone_number" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "pricing_category" TEXT NOT NULL DEFAULT '',
    "pricing_type" TEXT NOT NULL DEFAULT '',
    "tier" TEXT NOT NULL DEFAULT '',
    "volume" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(18,6),
    "currency" TEXT,
    "cost_status" "CostStatus" NOT NULL DEFAULT 'UNAVAILABLE',
    "source" "AnalyticsSource" NOT NULL DEFAULT 'META',
    "last_synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_sync_states" (
    "workspace_id" UUID NOT NULL,
    "whatsapp_account_id" UUID,
    "waba_id" TEXT,
    "currency" TEXT,
    "cost_status" "CostStatus" NOT NULL DEFAULT 'UNAVAILABLE',
    "last_run_at" TIMESTAMP(3),
    "last_ok_at" TIMESTAMP(3),
    "last_error" TEXT,
    "synced_through" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_sync_states_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "analytics_sync_runs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "window_days" INTEGER NOT NULL DEFAULT 0,
    "templates_read" INTEGER NOT NULL DEFAULT 0,
    "template_rows" INTEGER NOT NULL DEFAULT 0,
    "pricing_rows" INTEGER NOT NULL DEFAULT 0,
    "pruned_rows" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "analytics_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "template_daily_stats_workspace_id_date_idx" ON "template_daily_stats"("workspace_id", "date");

-- CreateIndex
CREATE INDEX "template_daily_stats_workspace_id_category_date_idx" ON "template_daily_stats"("workspace_id", "category", "date");

-- CreateIndex
CREATE UNIQUE INDEX "template_daily_stats_workspace_id_template_id_date_key" ON "template_daily_stats"("workspace_id", "template_id", "date");

-- CreateIndex
CREATE INDEX "pricing_daily_stats_workspace_id_date_idx" ON "pricing_daily_stats"("workspace_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_daily_stats_workspace_id_date_phone_number_country__key" ON "pricing_daily_stats"("workspace_id", "date", "phone_number", "country", "pricing_category", "pricing_type", "tier");

-- CreateIndex
CREATE INDEX "analytics_sync_runs_workspace_id_started_at_idx" ON "analytics_sync_runs"("workspace_id", "started_at");

-- AddForeignKey
ALTER TABLE "template_daily_stats" ADD CONSTRAINT "template_daily_stats_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_daily_stats" ADD CONSTRAINT "pricing_daily_stats_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_sync_states" ADD CONSTRAINT "analytics_sync_states_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_sync_runs" ADD CONSTRAINT "analytics_sync_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
