import {
  MODULE_KEYS,
  MODULE_LABELS,
  isConfigurableRole,
  moduleIn,
  type ConfigurableRole,
  type ModuleKey,
} from "@/config/modules";
import { request } from "@/lib/api/http";

export type { ConfigurableRole, ModuleKey } from "@/config/modules";

/** The four roles a membership can carry; only three are handed out. */
export type AccessRole = "OWNER" | ConfigurableRole;

export interface AccessView {
  role: AccessRole;
  /** The modules this role may open. An owner's list is the whole registry. */
  modules: ModuleKey[];
  /**
   * Whether the caller has a personal WhatsApp on their membership. The
   * follow-up strip sends from it, so its Send button can say why it is off
   * instead of failing after the click.
   */
  hasPersonalWhatsApp: boolean;
}

/** The three role→module lists the owner edits, as one object. */
export type RolePermissions = Record<ConfigurableRole, ModuleKey[]>;

/** What the owner's permissions screen reads and writes. */
export interface PermissionsView {
  /** The registry, in the order the screen renders it. */
  modules: { key: ModuleKey; label: string }[];
  roles: RolePermissions;
  /**
   * False when the toggles table is not installed yet, so the screen can say
   * it is showing the seeded defaults instead of pretending it saved.
   */
  stored: boolean;
}

/**
 * The caller's role and the modules it may open.
 *
 * One request per shell mount, not per page: the sidebar, the command palette
 * and the page gate all read the same answer, so they cannot disagree about
 * which screen is open.
 */
export function fetchAccess(): Promise<AccessView> {
  return request<AccessView>("/v1/workspaces/access", { method: "GET" }).then(
    (view) => ({
      role: view.role,
      modules: view.modules.filter(
        (key): key is ModuleKey => moduleIn(key) !== null,
      ),
      hasPersonalWhatsApp: view.hasPersonalWhatsApp === true,
    }),
  );
}

/** Owner-only. Answers 403 for anybody else, which is the point. */
export function fetchPermissions(): Promise<PermissionsView> {
  return request<PermissionsView>("/v1/workspaces/permissions", {
    method: "GET",
  }).then(normalise);
}

/**
 * Replaces the three roles' module lists in one write, so a half-saved screen
 * cannot leave one role reading a matrix its neighbours no longer match.
 */
export function savePermissions(
  roles: RolePermissions,
): Promise<PermissionsView> {
  const body = Object.fromEntries(
    (["ADMIN", "MANAGER", "AGENT"] as const).map((role) => [
      role,
      roles[role] ?? [],
    ]),
  );

  return request<PermissionsView>("/v1/workspaces/permissions", {
    method: "PUT",
    body: JSON.stringify({ roles: body }),
  }).then(normalise);
}

/**
 * Anything the API does not recognise is dropped rather than rendered: a
 * retired module must not reappear as a switch the owner can flip.
 */
function normalise(view: PermissionsView): PermissionsView {
  const clean = (list: readonly unknown[]) =>
    list
      .map((key) => moduleIn(key))
      .filter((key): key is ModuleKey => key !== null);

  const roles: RolePermissions = {
    ADMIN: [],
    MANAGER: [],
    AGENT: [],
  };

  for (const role of ["ADMIN", "MANAGER", "AGENT"] as const) {
    roles[role] = clean(view.roles?.[role] ?? []);
  }

  return {
    modules: MODULE_KEYS.map((key) => ({
      key,
      label:
        view.modules.find((entry) => moduleIn(entry.key) === key)?.label ??
        MODULE_LABELS[key],
    })),
    roles,
    stored: view.stored === true,
  };
}

/** Whether a role value is one the permissions screen may write. */
export function isAssignableRole(value: unknown): value is ConfigurableRole {
  return isConfigurableRole(value);
}
