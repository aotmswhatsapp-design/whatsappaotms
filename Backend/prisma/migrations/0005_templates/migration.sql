-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('AUTHENTICATION', 'MARKETING', 'UTILITY');

-- CreateEnum
CREATE TYPE "ParameterFormat" AS ENUM ('NAMED', 'POSITIONAL');

-- CreateTable
CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "meta_id" TEXT,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" "TemplateCategory" NOT NULL,
    "parameter_format" "ParameterFormat" NOT NULL DEFAULT 'POSITIONAL',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "quality_score" TEXT,
    "rejected_reason" TEXT,
    "components" JSONB NOT NULL,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_templates_workspace_id_status_idx" ON "message_templates"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_workspace_id_meta_id_key" ON "message_templates"("workspace_id", "meta_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_workspace_id_name_language_key" ON "message_templates"("workspace_id", "name", "language");

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

