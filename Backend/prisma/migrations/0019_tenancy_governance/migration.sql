-- A number belongs to exactly one workspace, and a workspace can invite people.
--
-- Two holes close here.
--
-- 1. Only `(workspace_id, phone_number_id)` was unique, so the same Meta number
--    could be connected in two workspaces. The webhook loads every row a
--    delivery names and stores the message per row, so both inboxes received it
--    and both agents answered — twice, with two knowledge bases. `phoneNumberId`
--    is now the key, which is what Meta names in every delivery.
--
-- 2. `workspace_members.role` existed with no way to add a member beyond the
--    owner. `workspace_invitations` is the first half of fixing that; the role
--    guard in the API is the other.

-- 1. Replace the pair key with the number itself. Safe to drop the plain index:
--    the unique index serves the same lookup.
DROP INDEX "whatsapp_accounts_workspace_id_phone_number_id_key";
DROP INDEX "whatsapp_accounts_phone_number_id_idx";

CREATE UNIQUE INDEX "whatsapp_accounts_phone_number_id_key"
  ON "whatsapp_accounts"("phone_number_id");

-- 2. Invitations. The token is never stored: `token_hash` is its SHA-256, so a
--    dump of this table cannot be replayed as join links.
CREATE TABLE "workspace_invitations" (
  "id"                 UUID NOT NULL,
  "workspace_id"       UUID NOT NULL,
  "email"              TEXT NOT NULL,
  "role"               "WorkspaceRole" NOT NULL,
  "token_hash"         TEXT NOT NULL,
  "invited_by_user_id" UUID NOT NULL,
  "expires_at"         TIMESTAMP(3) NOT NULL,
  "accepted_at"        TIMESTAMP(3),
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_invitations_token_hash_key"
  ON "workspace_invitations"("token_hash");
CREATE INDEX "workspace_invitations_workspace_id_idx"
  ON "workspace_invitations"("workspace_id");
CREATE INDEX "workspace_invitations_email_idx"
  ON "workspace_invitations"("email");

-- 3. One pending invitation per address per workspace. A partial index rather
--    than a column constraint, the same shape as the other hand-written rules:
--    accepted rows are history and may repeat when someone leaves and returns.
CREATE UNIQUE INDEX "workspace_invitations_one_pending_per_email"
  ON "workspace_invitations"("workspace_id", "email")
  WHERE "accepted_at" IS NULL;

ALTER TABLE "workspace_invitations"
  ADD CONSTRAINT "workspace_invitations_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_invitations"
  ADD CONSTRAINT "workspace_invitations_invited_by_user_id_fkey"
  FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
