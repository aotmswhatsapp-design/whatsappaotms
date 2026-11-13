import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type { AuthClaims } from "./auth.types";
import { UsersService } from "./users.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /**
   * Everything the signed-in shell needs in one round-trip: the mirrored
   * profile plus the workspaces the user can open.
   */
  async profile(claims: AuthClaims) {
    const user = await this.users.syncFromClaims(claims);

    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        workspace: {
          select: { id: true, name: true, slug: true, plan: true },
        },
      },
    });

    return {
      user,
      workspaces: memberships.map(({ role, workspace }) => ({
        ...workspace,
        role,
      })),
    };
  }
}
