import { createHash, randomBytes } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PlanTier, type WorkspaceRole } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { UsersService } from "../auth/users.service";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateMemberProfileDto } from "./dto/team.dto";
import {
  ALL_MODULES,
  CONFIGURABLE_ROLES,
  MODULE_DEFAULTS,
  MODULE_KEYS,
  MODULE_LABELS,
  effectiveModules,
  moduleIn,
  type ConfigurableRole,
  type ModuleKey,
} from "./modules";

/** Who is asking, and which tenant the answer belongs to. */
export interface WorkspaceContext {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

/** A member as the team screen reads them. */
export interface MemberView {
  userId: string;
  role: WorkspaceRole;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  /** The workspace owner: role immutable, membership irremovable. */
  owner: boolean;
  /** Free text: who this person is on the team. Null until the owner sets it. */
  designation: string | null;
  /** Digits only, country code first. Null until the owner sets it. */
  personalWhatsApp: string | null;
}

/**
 * A pending invitation. The token itself left the API once, when it was
 * created — the database keeps only its hash, so it cannot be printed again.
 */
export interface InvitationView {
  id: string;
  email: string;
  role: WorkspaceRole;
  createdAt: string;
  expiresAt: string;
  /** Who sent it, as a name where there is one. */
  invitedBy: string | null;
}

export interface WorkspaceView {
  id: string;
  name: string;
  slug: string;
  plan: PlanTier;
  /** The caller's own role, so the screen knows what to offer. */
  role: WorkspaceRole;
  members: MemberView[];
  invitations: InvitationView[];
}

/** What one caller may open, as the shell draws its sidebar from. */
export interface AccessView {
  role: WorkspaceRole;
  /** Module keys in registry order; an OWNER gets every one. */
  modules: ModuleKey[];
  /**
   * Whether this caller has a personal WhatsApp on their membership. The
   * follow-up strip sends from it, so the strip disables Send with the reason
   * instead of letting the click fail. The number itself stays off the wire.
   */
  hasPersonalWhatsApp: boolean;
}

/** The owner's matrix, with the registry so the screen needs no second read. */
export interface PermissionsView {
  modules: { key: ModuleKey; label: string }[];
  roles: Record<ConfigurableRole, ModuleKey[]>;
  /**
   * False when the toggles table is not installed yet, so the screen can say
   * plainly that it is showing defaults and cannot save.
   */
  stored: boolean;
}

/** A link that is not used within a week is no longer worth honouring. */
const INVITE_DAYS = 7;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The tenant every business table hangs off.
 *
 * Until now `Workspace` existed in the schema but nothing created one, so a
 * login owned its rows directly. The inbox is the first surface where that
 * breaks — assignment and a shared queue only mean something if two agents can
 * see the same conversation. This service is the single place that turns an
 * authenticated caller into a workspace, creating one on first use.
 */
@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  /** The missing-table warning is worth saying once, not once per request. */
  private warnedMissingAccess = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /**
   * The workspace a request acts in.
   *
   * One per account today: there is no workspace picker in the shell, and
   * adding one means changing every call site. The oldest membership wins, so
   * an invited agent lands in the workspace they joined first.
   *
   * The first call for an account provisions. The slug is derived from the
   * user id and is unique, which is what makes two tabs racing on first load
   * converge instead of creating a second workspace.
   */
  async primaryFor(claims: AuthClaims): Promise<WorkspaceContext> {
    const user = await this.users.syncFromClaims(claims);

    const existing = await this.membershipOf(user.id);

    if (existing) {
      return { userId: user.id, ...existing };
    }

    const name = user.fullName?.trim() || user.email.split("@")[0] || "Workspace";
    const slug = `ws-${user.id.replace(/-/g, "").slice(0, 12)}`;

    try {
      const created = await this.prisma.workspace.create({
        data: {
          name,
          slug,
          ownerId: user.id,
          members: { create: { userId: user.id, role: "OWNER" } },
        },
        select: { id: true },
      });

      this.logger.log(`Provisioned a workspace for a new account (${created.id}).`);

      return { userId: user.id, workspaceId: created.id, role: "OWNER" };
    } catch (error) {
      // The loser of a provisioning race reads the winner's row rather than
      // failing a page load.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const raced = await this.membershipOf(user.id);

        if (raced) return { userId: user.id, ...raced };
      }

      throw error;
    }
  }

  /** Members of a workspace, for an assignee menu. */
  members(workspaceId: string) {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        user: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      },
    });
  }

  /**
   * The team screen: the workspace, its members and its pending invitations.
   * One call, because the screen has nothing to draw without all three.
   */
  async view(claims: AuthClaims): Promise<WorkspaceView> {
    const context = await this.primaryFor(claims);

    const [workspace, members, invitations] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({
        where: { id: context.workspaceId },
        select: { id: true, name: true, slug: true, plan: true, ownerId: true },
      }),
      this.prisma.workspaceMember.findMany({
        where: { workspaceId: context.workspaceId },
        orderBy: { createdAt: "asc" },
        select: {
          userId: true,
          role: true,
          designation: true,
          personalWhatsApp: true,
          user: { select: { fullName: true, email: true, avatarUrl: true } },
        },
      }),
      this.prisma.workspaceInvitation.findMany({
        where: { workspaceId: context.workspaceId, acceptedAt: null },
        orderBy: { createdAt: "desc" },
        select: INVITATION_SELECT,
      }),
    ]);

    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      plan: workspace.plan,
      role: context.role,
      members: members.map((row) => memberView(row, workspace.ownerId)),
      invitations: invitations.map(invitationView),
    };
  }

  /** The caller's role, for the guard. Null means no workspace yet. */
  async roleFor(userId: string): Promise<WorkspaceRole | null> {
    return (await this.membershipOf(userId))?.role ?? null;
  }

  /** The caller's membership, for the guard. Null means no workspace yet. */
  async membershipFor(
    userId: string,
  ): Promise<{ workspaceId: string; role: WorkspaceRole } | null> {
    return this.membershipOf(userId);
  }

  /**
   * The modules one role may open here.
   *
   * Read on every module-gated request. A database without the toggles
   * migration answers the seeded defaults instead of failing: the page is
   * gated either way, and an optional table must not take the inbox down.
   */
  async modulesFor(
    workspaceId: string,
    role: WorkspaceRole,
  ): Promise<ModuleKey[]> {
    if (role === "OWNER") return [...ALL_MODULES];

    const { rows } = await this.accessRows(workspaceId);

    return effectiveModules(role, rows);
  }

  /** What the caller may open, for the shell's sidebar. */
  async access(claims: AuthClaims): Promise<AccessView> {
    const { workspaceId, userId, role } = await this.primaryFor(claims);

    const [modules, membership] = await Promise.all([
      this.modulesFor(workspaceId, role),
      this.prisma.workspaceMember.findFirst({
        where: { workspaceId, userId },
        select: { personalWhatsApp: true },
      }),
    ]);

    return {
      role,
      modules,
      hasPersonalWhatsApp: Boolean(membership?.personalWhatsApp?.trim()),
    };
  }

  /**
   * The owner's matrix. Only the permissions screen reads it; a member needs
   * nothing more than their own `access`.
   */
  async permissions(claims: AuthClaims): Promise<PermissionsView> {
    const { workspaceId } = await this.primaryFor(claims);
    const { rows, stored } = await this.accessRows(workspaceId);

    const forRole = (role: ConfigurableRole) =>
      effectiveModules(
        role,
        rows.filter((row) => row.role === role),
      );

    return {
      modules: MODULE_KEYS.map((key) => ({ key, label: MODULE_LABELS[key] })),
      roles: {
        ADMIN: forRole("ADMIN"),
        MANAGER: forRole("MANAGER"),
        AGENT: forRole("AGENT"),
      },
      stored,
    };
  }

  /**
   * Replaces the toggles for every role the request names.
   *
   * A role left out is untouched, so a screen that only edits one role cannot
   * blank the others. Only rows that differ from the defaults are written: the
   * reader lays them over the defaults, and a module added later stays visible
   * until the owner says otherwise.
   */
  async setPermissions(
    claims: AuthClaims,
    roles: Record<string, unknown>,
  ): Promise<PermissionsView> {
    const { workspaceId } = await this.primaryFor(claims);
    const { stored } = await this.accessRows(workspaceId);

    if (!stored) {
      throw new ConflictException({
        code: "ROLE_ACCESS_MISSING",
        message:
          "The permission table is not installed yet, so only the seeded defaults are in force.",
      });
    }

    const wanted = readPermissionInput(roles);

    await this.prisma.$transaction(async (tx) => {
      for (const role of CONFIGURABLE_ROLES) {
        const modules = wanted[role];

        if (!modules) continue;

        const defaults = new Set<ModuleKey>(MODULE_DEFAULTS[role]);
        const chosen = new Set<ModuleKey>(modules);

        await tx.workspaceRoleAccess.deleteMany({ where: { workspaceId, role } });

        const rows = MODULE_KEYS.filter(
          (key) => chosen.has(key) !== defaults.has(key),
        ).map((key) => ({
          workspaceId,
          role,
          module: key,
          enabled: chosen.has(key),
        }));

        if (rows.length > 0) {
          await tx.workspaceRoleAccess.createMany({ data: rows });
        }
      }
    });

    return this.permissions(claims);
  }

  /**
   * Creates an invitation and returns its token exactly once.
   *
   * This deployment has no mailer, so the link is handed to the owner to pass
   * on. Re-inviting the same address replaces the pending row rather than
   * stacking — the older link stops working the moment this one exists, which
   * is also what keeps the partial unique index satisfied.
   */
  async invite(
    claims: AuthClaims,
    input: { email: string; role: WorkspaceRole },
  ): Promise<{ invitation: InvitationView; token: string }> {
    const { workspaceId, userId } = await this.primaryFor(claims);
    const email = input.email.trim().toLowerCase();

    const already = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, user: { email } },
      select: { userId: true },
    });

    if (already) {
      throw new ConflictException({
        code: "ALREADY_MEMBER",
        message: "That address is already on this team.",
      });
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.workspaceInvitation.deleteMany({
        where: { workspaceId, email, acceptedAt: null },
      });

      return tx.workspaceInvitation.create({
        data: {
          workspaceId,
          email,
          role: input.role,
          tokenHash: hashToken(token),
          invitedByUserId: userId,
          expiresAt,
        },
        select: INVITATION_SELECT,
      });
    });

    return { invitation: invitationView(created), token };
  }

  /** Withdraws a pending invitation. The link immediately stops working. */
  async revoke(claims: AuthClaims, id: string): Promise<{ ok: true }> {
    const { workspaceId } = await this.primaryFor(claims);

    if (!UUID.test(id)) {
      throw new NotFoundException({
        code: "INVITE_MISSING",
        message: "That invitation is no longer pending.",
      });
    }

    const result = await this.prisma.workspaceInvitation.deleteMany({
      where: { id, workspaceId, acceptedAt: null },
    });

    if (result.count === 0) {
      throw new NotFoundException({
        code: "INVITE_MISSING",
        message: "That invitation is no longer pending.",
      });
    }

    return { ok: true };
  }

  /**
   * Joins the workspace an invitation names.
   *
   * Deliberately not `primaryFor`: that would provision a workspace of the
   * invitee's own just to accept somebody else's. The signed-in email must be
   * the invited one, so a forwarded link cannot add the wrong person.
   */
  async accept(
    claims: AuthClaims,
    token: string,
  ): Promise<{ workspaceId: string; joined: boolean }> {
    const user = await this.users.syncFromClaims(claims);

    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        workspaceId: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
      },
    });

    if (!invitation || invitation.acceptedAt) {
      throw new NotFoundException({
        code: "INVITE_INVALID",
        message: "This invitation link is no longer valid. Ask for a new one.",
      });
    }

    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new ConflictException({
        code: "INVITE_EXPIRED",
        message: "This invitation has expired. Ask for a new one.",
      });
    }

    if (invitation.email !== user.email.toLowerCase()) {
      throw new ForbiddenException({
        code: "INVITE_EMAIL",
        message:
          "This invitation was sent to a different email address. Sign in with the address it was sent to.",
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: invitation.workspaceId,
            userId: user.id,
          },
        },
        select: { userId: true },
      });

      if (!existing) {
        await tx.workspaceMember.create({
          data: {
            workspaceId: invitation.workspaceId,
            userId: user.id,
            role: invitation.role,
          },
        });
      }

      // Marked either way: a second click on the same link is a no-op rather
      // than an error, and the row stays as the record of who joined.
      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      return {
        workspaceId: invitation.workspaceId,
        joined: existing === null,
      };
    });
  }

  /**
   * Changes a member's role, ownership included: a workspace may hold more than
   * one owner, and this is where a second one is made.
   *
   * Two seats are fixed. The account the workspace was created with cannot be
   * demoted, so no combination of other edits can leave it ownerless; and no
   * caller may change their own role, so an owner cannot hand away their seat
   * by a stray click in the row beside their name.
   */
  async changeRole(
    claims: AuthClaims,
    userId: string,
    role: WorkspaceRole,
  ): Promise<{ member: MemberView }> {
    const { workspaceId } = await this.primaryFor(claims);
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { ownerId: true },
    });

    if (userId === workspace.ownerId) {
      throw new ConflictException({
        code: "OWNER_IMMUTABLE",
        message:
          "The account that created this workspace always keeps its role, so the workspace always has an owner.",
      });
    }

    if (userId === claims.id) {
      throw new ConflictException({
        code: "SELF_ROLE",
        message: "You cannot change your own role. Ask another owner to do it.",
      });
    }

    const updated = await this.prisma.workspaceMember.updateMany({
      where: { workspaceId, userId },
      data: { role },
    });

    if (updated.count === 0) {
      throw new NotFoundException({
        code: "MEMBER_MISSING",
        message: "That person is not on this team.",
      });
    }

    const row = await this.prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: {
        userId: true,
        role: true,
        designation: true,
        personalWhatsApp: true,
        user: { select: { fullName: true, email: true, avatarUrl: true } },
      },
    });

    return { member: memberView(row, workspace.ownerId) };
  }

  /**
   * The owner edits a member's profile: the name customers never see, the
   * designation the lead router filters on, and the personal number a
   * follow-up is sent from. Every field is optional; `null` clears it.
   */
  async updateProfile(
    claims: AuthClaims,
    userId: string,
    dto: UpdateMemberProfileDto,
  ): Promise<{ member: MemberView }> {
    const { workspaceId } = await this.primaryFor(claims);
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { ownerId: true },
    });

    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { userId: true },
    });

    if (!member) {
      throw new NotFoundException({
        code: "MEMBER_MISSING",
        message: "That person is not on this team.",
      });
    }

    if (dto.fullName !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { fullName: dto.fullName?.trim() ? dto.fullName.trim() : null },
      });
    }

    const data: { designation?: string | null; personalWhatsApp?: string | null } = {};

    if (dto.designation !== undefined) {
      data.designation = dto.designation?.trim() ? dto.designation.trim() : null;
    }

    if (dto.personalWhatsApp !== undefined) {
      data.personalWhatsApp = dto.personalWhatsApp ?? null;
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId } },
        data,
      });
    }

    const row = await this.prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: {
        userId: true,
        role: true,
        designation: true,
        personalWhatsApp: true,
        user: { select: { fullName: true, email: true, avatarUrl: true } },
      },
    });

    return { member: memberView(row, workspace.ownerId) };
  }

  /**
   * Removes a membership. The account the workspace was created with is
   * refused by name — it carries the workspace's owner field, so removing it
   * would orphan the row. A second owner is removable like anyone else.
   *
   * Their work does not leave with them: an open follow-up moves to the owner
   * (the same fallback intake uses when rotation finds nobody), and their
   * threads become unassigned so the next interested message can bind them to
   * a real member. `FollowUpTask.assignedTo` points at the user, not the
   * membership, so its `SetNull` never fires here.
   *
   * Reached only by an owner's route today, so a member cannot remove
   * themselves; asking to be removed is the path back until a self-leave
   * route exists.
   */
  async remove(claims: AuthClaims, userId: string): Promise<{ ok: true }> {
    const { workspaceId } = await this.primaryFor(claims);
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { ownerId: true },
    });

    if (userId === workspace.ownerId) {
      throw new ConflictException({
        code: "OWNER_IMMUTABLE",
        message:
          "The account that created this workspace cannot be removed.",
      });
    }

    // Before the membership goes, so a failure here leaves a state that a
    // second attempt can still repair.
    await this.releaseWork(workspaceId, userId, workspace.ownerId);

    const result = await this.prisma.workspaceMember.deleteMany({
      where: { workspaceId, userId },
    });

    if (result.count === 0) {
      throw new NotFoundException({
        code: "MEMBER_MISSING",
        message: "That person is not on this team.",
      });
    }

    // A task can be inserted between the release above and the delete, by a
    // pass that read the assignee while they were still here. The writers
    // re-check membership after inserting, but one that checked just before
    // the delete still needs this second pass.
    await this.releaseWork(workspaceId, userId, workspace.ownerId);

    return { ok: true };
  }

  /**
   * Hands a departing member's work back to the workspace: their OPEN
   * follow-ups to the owner, their threads unassigned so the next interested
   * message can bind them to somebody who is still here.
   */
  private async releaseWork(
    workspaceId: string,
    userId: string,
    ownerId: string,
  ): Promise<void> {
    await this.prisma.followUpTask.updateMany({
      where: { workspaceId, assignedToUserId: userId, status: "OPEN" },
      data: { assignedToUserId: ownerId },
    });

    await this.prisma.conversation.updateMany({
      where: { workspaceId, assignedToUserId: userId },
      data: { assignedToUserId: null },
    });
  }

  private async accessRows(
    workspaceId: string,
  ): Promise<{
    rows: { role: WorkspaceRole; module: string; enabled: boolean }[];
    stored: boolean;
  }> {
    try {
      const rows = await this.prisma.workspaceRoleAccess.findMany({
        where: { workspaceId },
        select: { role: true, module: true, enabled: true },
      });

      return { rows, stored: true };
    } catch (error) {
      if (!missingAccessTable(error)) throw error;

      if (!this.warnedMissingAccess) {
        this.warnedMissingAccess = true;
        this.logger.warn(
          "workspace_role_access is missing; role modules fall back to the seeded defaults.",
        );
      }

      return { rows: [], stored: false };
    }
  }

  private membershipOf(
    userId: string,
  ): Promise<{ workspaceId: string; role: WorkspaceRole } | null> {
    return this.prisma.workspaceMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true, role: true },
    });
  }
}

type MemberRow = {
  userId: string;
  role: WorkspaceRole;
  designation: string | null;
  personalWhatsApp: string | null;
  user: { fullName: string | null; email: string; avatarUrl: string | null };
};

/** One shape for the team screen, the role change and a profile edit. */
function memberView(row: MemberRow, ownerId: string): MemberView {
  return {
    userId: row.userId,
    role: row.role,
    name: row.user.fullName,
    email: row.user.email,
    avatarUrl: row.user.avatarUrl,
    owner: row.userId === ownerId,
    designation: row.designation,
    personalWhatsApp: row.personalWhatsApp,
  };
}

const INVITATION_SELECT = {
  id: true,
  email: true,
  role: true,
  createdAt: true,
  expiresAt: true,
  invitedBy: { select: { fullName: true, email: true } },
} as const;

function invitationView(row: {
  id: string;
  email: string;
  role: WorkspaceRole;
  createdAt: Date;
  expiresAt: Date;
  invitedBy: { fullName: string | null; email: string };
}): InvitationView {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    invitedBy: row.invitedBy.fullName ?? row.invitedBy.email,
  };
}

/** Stored, never the token itself — a dump of the table cannot be replayed. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A database that predates the toggles migration: the request is answered from
 * the seeded defaults rather than failing. Prisma reports P2021; the message
 * check covers a driver that answers in words instead.
 */
function missingAccessTable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2021") return true;
  }

  return error instanceof Error && /relation .* does not exist/i.test(error.message);
}

/**
 * A submitted role→modules map, checked before anything is written.
 *
 * A role that is absent is left alone; a role that is present must be a list of
 * modules this build knows, so a typo cannot create a route into nothing.
 */
function readPermissionInput(
  roles: Record<string, unknown>,
): Partial<Record<ConfigurableRole, ModuleKey[]>> {
  const wanted: Partial<Record<ConfigurableRole, ModuleKey[]>> = {};

  for (const role of CONFIGURABLE_ROLES) {
    const value = roles[role];

    if (value === undefined) continue;

    if (!Array.isArray(value)) {
      throw new BadRequestException({
        code: "ROLE_ACCESS_INVALID",
        message: `The modules for ${role} must be a list.`,
      });
    }

    const modules: ModuleKey[] = [];

    for (const entry of value) {
      const key = moduleIn(entry);

      if (!key) {
        throw new BadRequestException({
          code: "ROLE_ACCESS_INVALID",
          message: `There is no workspace module called “${String(entry)}”.`,
        });
      }

      if (!modules.includes(key)) modules.push(key);
    }

    wanted[role] = modules;
  }

  if (Object.keys(wanted).length === 0) {
    throw new BadRequestException({
      code: "ROLE_ACCESS_INVALID",
      message: "Name at least one role to change.",
    });
  }

  return wanted;
}
