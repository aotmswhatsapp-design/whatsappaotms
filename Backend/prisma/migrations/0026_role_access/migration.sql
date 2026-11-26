-- The workspace roles become the PRD's three, plus an administrator above the
-- Manager: OWNER > ADMIN > MANAGER > AGENT.
--
-- `IF NOT EXISTS` because a deployment that already added the value by hand
-- must not fail this migration; adding an enum member is idempotent in intent
-- even though PostgreSQL needs the clause to make it so.
ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'MANAGER';

-- Per-role module toggles. Only changed modules get a row: the reader merges
-- these over the defaults in `Backend/src/workspaces/modules.ts`, which is also
-- what lets a new module ship without a backfill.
CREATE TABLE "workspace_role_access" (
    "workspace_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "module" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_role_access_pkey" PRIMARY KEY ("workspace_id","role","module")
);

-- Deleting a workspace takes its toggles with it, like every other tenant row.
ALTER TABLE "workspace_role_access"
    ADD CONSTRAINT "workspace_role_access_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
