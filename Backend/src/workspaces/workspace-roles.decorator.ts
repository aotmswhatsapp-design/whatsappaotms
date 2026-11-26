import { SetMetadata } from "@nestjs/common";
import type { WorkspaceRole } from "@prisma/client";

import type { ModuleKey } from "./modules";

export const WORKSPACE_ROLES = "workspace-roles";
export const WORKSPACE_MODULE = "workspace-module";

/**
 * The least role a caller needs. `@Roles("MANAGER")` admits an ADMIN too:
 * roles are a ladder, not a set, and `AGENT` < `MANAGER` < `ADMIN` < `OWNER`.
 *
 * A route without this decorator needs only a signed-in member — the inbox is
 * the reason that has to stay true for every role.
 */
export const Roles = (...roles: WorkspaceRole[]) =>
  SetMetadata(WORKSPACE_ROLES, roles);

/**
 * The module a route belongs to. The owner's per-role toggles decide whether a
 * caller may use it; an OWNER always may.
 *
 * Only the module's own surface carries this. Reads another module depends on —
 * the workspace itself, the WhatsApp status the sidebar polls, the agent list a
 * chat card is sent to — are deliberately left ungated, because a hidden page
 * must not take a working page down with it.
 */
export const RequiresModule = (module: ModuleKey) =>
  SetMetadata(WORKSPACE_MODULE, module);

/** Higher wins. The PRD's four roles, in the order it describes them. */
export const ROLE_RANK: Record<WorkspaceRole, number> = {
  AGENT: 1,
  MANAGER: 2,
  ADMIN: 3,
  OWNER: 4,
};
