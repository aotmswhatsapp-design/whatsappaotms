import { SetMetadata } from "@nestjs/common";
import type { WorkspaceRole } from "@prisma/client";

export const WORKSPACE_ROLES = "workspace-roles";

/**
 * The least role a caller needs. `@Roles("ADMIN")` admits an OWNER too: roles
 * are a ladder, not a set, and `AGENT` < `ADMIN` < `OWNER`.
 *
 * A route without this decorator needs only a signed-in member — the inbox is
 * the reason that has to stay true for every role.
 */
export const Roles = (...roles: WorkspaceRole[]) =>
  SetMetadata(WORKSPACE_ROLES, roles);

/** Higher wins. `ADMIN` is the PRD's Manager, `AGENT` its Support Agent. */
export const ROLE_RANK: Record<WorkspaceRole, number> = {
  AGENT: 1,
  ADMIN: 2,
  OWNER: 3,
};
