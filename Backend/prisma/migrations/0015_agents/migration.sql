-- AI agents: one prompt, a knowledge base of extracted text, and the runs that
-- used them. pgvector is installed here because nothing needed it before.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;

-- CreateEnum
CREATE TYPE "AgentSourceKind" AS ENUM ('TEXT', 'FILE');

-- CreateEnum
CREATE TYPE "AgentSourceStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentRunKind" AS ENUM ('REPLY', 'PLAYGROUND');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'CLAIMED', 'SENT', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "conversations"
  ADD COLUMN "ai_paused_at" TIMESTAMP(3),
  ADD COLUMN "ai_paused_by_user_id" UUID,
  ADD COLUMN "ai_pause_reason" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "agent_id" UUID;

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "whatsapp_account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "system_prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'gpt-5.4-mini',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "max_reply_chars" INTEGER NOT NULL DEFAULT 900,
    "escalate_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "kind" "AgentSourceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "mime" TEXT,
    "size" INTEGER,
    "storage_path" TEXT,
    "text" TEXT,
    "status" "AgentSourceStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "char_count" INTEGER NOT NULL DEFAULT 0,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "embed_tokens" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "indexed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "ord" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "kind" "AgentRunKind" NOT NULL DEFAULT 'REPLY',
    "conversation_id" UUID,
    "inbound_message_id" UUID,
    "outbound_message_id" UUID,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "reason" TEXT,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "embedding_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agents_whatsapp_account_id_is_active_idx" ON "agents"("whatsapp_account_id", "is_active");

-- CreateIndex
CREATE INDEX "agents_workspace_id_created_at_idx" ON "agents"("workspace_id", "created_at");

-- One active agent per number: a database fact, not a service convention two
-- concurrent activations can interleave and break.
CREATE UNIQUE INDEX "agents_one_active_per_account" ON "agents"("whatsapp_account_id") WHERE "is_active";

-- CreateIndex
CREATE INDEX "knowledge_sources_agent_id_created_at_idx" ON "knowledge_sources"("agent_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_source_id_ord_key" ON "knowledge_chunks"("source_id", "ord");

-- CreateIndex
CREATE INDEX "knowledge_chunks_source_id_idx" ON "knowledge_chunks"("source_id");

-- Cosine, because the model's vectors are normalised and cosine is what the
-- operator means by "similar". 1536 dims is well inside HNSW's 2000.
CREATE INDEX "knowledge_chunks_embedding_idx"
  ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- CreateIndex
CREATE INDEX "agent_runs_status_created_at_idx" ON "agent_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_agent_id_created_at_idx" ON "agent_runs"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_conversation_id_created_at_idx" ON "agent_runs"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_inbound_message_id_key" ON "agent_runs"("inbound_message_id");

-- CreateIndex
CREATE INDEX "messages_agent_id_idx" ON "messages"("agent_id");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_whatsapp_account_id_fkey" FOREIGN KEY ("whatsapp_account_id") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_ai_paused_by_user_id_fkey" FOREIGN KEY ("ai_paused_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
