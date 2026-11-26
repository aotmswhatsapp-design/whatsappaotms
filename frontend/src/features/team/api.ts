import { request } from "@/lib/api/http";

export { ApiError } from "@/lib/api/http";

// The permissions screen's two calls belong to the workspace access contract,
// not to this feature; re-exported so the team screens import one module.
export {
  fetchPermissions,
  savePermissions,
  type PermissionsView,
  type RolePermissions,
} from "@/lib/access/api";

/**
 * The PRD's three roles plus ownership, under the names the schema stores:
 * `OWNER` is the Business Owner, `ADMIN` the day-to-day admin, `MANAGER` the
 * PRD's Manager and `AGENT` the Support Agent.
 */
export type TeamRole = "OWNER" | "ADMIN" | "MANAGER" | "AGENT";

/** Ownership is not handed out by an invitation, so it is not offerable. */
export type MemberRole = Exclude<TeamRole, "OWNER">;

/** The order the role pickers offer: least access first, ownership last. */
export const MEMBER_ROLES: readonly MemberRole[] = [
  "AGENT",
  "MANAGER",
  "ADMIN",
];

export const ROLE_LABELS: Record<TeamRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  AGENT: "Agent",
};

/** What each role may do, in the words the invite form uses. */
export const ROLE_HINTS: Record<TeamRole, string> = {
  OWNER: "Owns the workspace and its WhatsApp number: team, connection and billing.",
  ADMIN: "Runs campaigns, templates, the chatbot and the inbox, but cannot connect the number.",
  MANAGER: "Runs campaigns, owns contacts and reads analytics. Hands conversations to agents.",
  AGENT: "Answers conversations assigned to them and the unclaimed ones. Leaves notes.",
};

export interface Member {
  userId: string;
  role: TeamRole;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  /** The workspace owner: role immutable, membership irremovable. */
  owner: boolean;
}

/**
 * A pending invitation. The token left the API once, when it was created —
 * only its hash is stored, so a link cannot be shown again from this row.
 */
export interface Invitation {
  id: string;
  email: string;
  role: TeamRole;
  createdAt: string;
  expiresAt: string;
  invitedBy: string | null;
}

export interface TeamWorkspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  /** The caller's own role, which decides what the screen offers. */
  role: TeamRole;
  members: Member[];
  invitations: Invitation[];
}

/** The workspace, its members and its pending invites, in one read. */
export function fetchTeam(): Promise<TeamWorkspace> {
  return request<TeamWorkspace>("/v1/workspaces", { method: "GET" });
}

/**
 * Creates the invitation and returns its link token exactly once. Re-inviting
 * the same address replaces the pending row, so the older link stops working.
 */
export function inviteMember(input: {
  email: string;
  role: MemberRole;
}): Promise<{ invitation: Invitation; token: string }> {
  return request<{ invitation: Invitation; token: string }>(
    "/v1/workspaces/invitations",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function revokeInvitation(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    `/v1/workspaces/invitations/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export function changeMemberRole(
  userId: string,
  role: MemberRole,
): Promise<{ member: Member }> {
  return request<{ member: Member }>(
    `/v1/workspaces/members/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
}

export function removeMember(userId: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    `/v1/workspaces/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
}

/**
 * Joins the workspace the link names. The signed-in address must be the
 * invited one, so a forwarded link cannot add the wrong person.
 */
export function acceptInvitation(
  token: string,
): Promise<{ workspaceId: string; joined: boolean }> {
  return request<{ workspaceId: string; joined: boolean }>(
    "/v1/workspaces/invitations/accept",
    { method: "POST", body: JSON.stringify({ token }) },
  );
}

/** The link the owner passes on; there is no mailer in this deployment. */
export function inviteUrl(token: string): string {
  const origin =
    typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/workspace/join?token=${encodeURIComponent(token)}`;
}
