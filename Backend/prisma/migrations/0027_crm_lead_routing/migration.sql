-- CRM lead routing: a stage on every conversation, one open follow-up task per
-- thread, and the owner's routing settings.
--
-- Hand-written because Prisma DDL cannot express a partial unique index, and
-- because this repository authors migrations as SQL and applies them with
-- `prisma migrate deploy` (never `migrate dev` or `db push`).

CREATE TYPE "LeadInterest" AS ENUM ('UNKNOWN', 'INTERESTED', 'NOT_INTERESTED');
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- Who a lead of this designation goes to, and where the rotation left off.
ALTER TABLE "workspace_members"
    ADD COLUMN "designation" TEXT,
    ADD COLUMN "personal_whatsapp" TEXT,
    ADD COLUMN "last_assigned_at" TIMESTAMP(3);

CREATE INDEX "workspace_members_workspace_id_designation_idx"
    ON "workspace_members" ("workspace_id", "designation");

-- Existing conversations start UNKNOWN with no timestamp: the column default
-- covers them, and no backfill is written into a migration.
ALTER TABLE "conversations"
    ADD COLUMN "interest" "LeadInterest" NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN "interest_score" INTEGER,
    ADD COLUMN "interest_reason" TEXT,
    ADD COLUMN "interest_at" TIMESTAMP(3);

CREATE INDEX "conversations_workspace_id_interest_last_message_at_idx"
    ON "conversations" ("workspace_id", "interest", "last_message_at");

CREATE TABLE "follow_up_tasks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "assigned_to_user_id" UUID,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "due_at" TIMESTAMP(3),
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "follow_up_tasks_workspace_id_status_due_at_idx"
    ON "follow_up_tasks" ("workspace_id", "status", "due_at");
CREATE INDEX "follow_up_tasks_assigned_to_user_id_status_idx"
    ON "follow_up_tasks" ("assigned_to_user_id", "status");

-- One open task per thread: a retried delivery or a second "price?" message
-- must find the existing task, never stack a second one.
CREATE UNIQUE INDEX "follow_up_tasks_one_open_per_conversation"
    ON "follow_up_tasks" ("conversation_id")
    WHERE "status" = 'OPEN';

-- Deleting a workspace or a thread takes its tasks with it, like every other
-- tenant row; an assignee leaving keeps the task and frees it.
ALTER TABLE "follow_up_tasks"
    ADD CONSTRAINT "follow_up_tasks_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_up_tasks"
    ADD CONSTRAINT "follow_up_tasks_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_up_tasks"
    ADD CONSTRAINT "follow_up_tasks_assigned_to_user_id_fkey"
    FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "crm_settings" (
    "workspace_id" UUID NOT NULL,
    "lead_designation" TEXT,
    "auto_assign" BOOLEAN NOT NULL DEFAULT true,
    "auto_task" BOOLEAN NOT NULL DEFAULT true,
    "task_due_hours" INTEGER NOT NULL DEFAULT 24,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_settings_pkey" PRIMARY KEY ("workspace_id")
);

ALTER TABLE "crm_settings"
    ADD CONSTRAINT "crm_settings_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
