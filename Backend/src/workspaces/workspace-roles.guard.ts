import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { WorkspaceRole } from "@prisma/client";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { WorkspacesService } from "./workspaces.service";
import { ROLE_RANK, WORKSPACE_ROLES } from "./workspace-roles.decorator";

/**
 * Turns `@Roles(...)` into a refusal.
 *
 * The membership is the same one `primaryFor` resolves, read through the same
 * private lookup, so the guard and the handler can never disagree about which
 * workspace a request acts in. One indexed read per gated request; unguarded
 * routes pay nothing.
 */
@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly workspaces: WorkspacesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<WorkspaceRole[]>(
      WORKSPACE_ROLES,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const claims = request.auth;

    if (!claims) throw new UnauthorizedException();

    // A brand-new account owns no membership until something provisions one,
    // and their first request may well be a mutation. Provisioning here keeps
    // that click from failing with a role error it would have passed a moment
    // later. The one route that must not provision, accepting an invitation,
    // carries no `@Roles` and never reaches this far.
    const role =
      (await this.workspaces.roleFor(claims.id)) ??
      (await this.workspaces.primaryFor(claims)).role;
    const minimum = Math.min(...required.map((needed) => ROLE_RANK[needed]));

    if (ROLE_RANK[role] < minimum) {
      throw new ForbiddenException({
        code: "ROLE_REQUIRED",
        message:
          minimum >= ROLE_RANK.OWNER
            ? "Only the workspace owner can do this."
            : "Your role in this workspace does not allow this.",
      });
    }

    return true;
  }
}
