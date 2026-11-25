import { createHash, randomBytes } from "node:crypto";

import {
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
      members: members.map((row) => ({
        userId: row.userId,
        role: row.role,
        name: row.user.fullName,
        email: row.user.email,
        avatarUrl: row.user.avatarUrl,
        owner: row.userId === workspace.ownerId,
      })),
      invitations: invitations.map(invitationView),
    };
  }

  /** The caller's role, for the guard. Null means no workspace yet. */
  async roleFor(userId: string): Promise<WorkspaceRole | null> {
    return (await this.membershipOf(userId))?.role ?? null;
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
   * Changes a member's role. Ownership is not transferable through this API,
   * which also means the owner can never be demoted by accident — there is no
   * second owner to hand the workspace to.
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
        message: "The workspace owner's role cannot be changed.",
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
        user: { select: { fullName: true, email: true, avatarUrl: true } },
      },
    });

    return {
      member: {
        userId: row.userId,
        role: row.role,
        name: row.user.fullName,
        email: row.user.email,
        avatarUrl: row.user.avatarUrl,
        owner: false,
      },
    };
  }

  /**
   * Removes a membership. The owner is refused by name — there is no second
   * owner to hand the workspace to, so leaving would orphan it.
   *
   * Reached only by the owner's route today, so a member cannot remove
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
          "The workspace owner cannot be removed, and ownership cannot be transferred yet.",
      });
    }

    const result = await this.prisma.workspaceMember.deleteMany({
      where: { workspaceId, userId },
    });

    if (result.count === 0) {
      throw new NotFoundException({
        code: "MEMBER_MISSING",
        message: "That person is not on this team.",
      });
    }

    return { ok: true };
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
