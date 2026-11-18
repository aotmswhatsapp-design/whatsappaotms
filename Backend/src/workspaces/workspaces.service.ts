import { Injectable, Logger } from "@nestjs/common";
import { Prisma, type WorkspaceRole } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { UsersService } from "../auth/users.service";
import { PrismaService } from "../prisma/prisma.service";

/** Who is asking, and which tenant the answer belongs to. */
export interface WorkspaceContext {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

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
