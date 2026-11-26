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
import { MODULE_LABELS, type ModuleKey } from "./modules";
import { WorkspacesService } from "./workspaces.service";
import {
  ROLE_RANK,
  WORKSPACE_MODULE,
  WORKSPACE_ROLES,
} from "./workspace-roles.decorator";

/**
 * Turns `@Roles(...)` and `@RequiresModule(...)` into a refusal.
 *
 * The membership is the same one `primaryFor` resolves, read through the same
 * private lookup, so the guard and the handler can never disagree about which
 * workspace a request acts in. One indexed read per gated request, plus one
 * more only when a module is named; unguarded routes pay nothing.
 */
@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly workspaces: WorkspacesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const [required, module] = [
      this.reflector.getAllAndOverride<WorkspaceRole[]>(WORKSPACE_ROLES, [
        context.getHandler(),
        context.getClass(),
      ]),
      this.reflector.getAllAndOverride<ModuleKey>(WORKSPACE_MODULE, [
        context.getHandler(),
        context.getClass(),
      ]),
    ];

    if ((!required || required.length === 0) && !module) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const claims = request.auth;

    if (!claims) throw new UnauthorizedException();

    // A brand-new account owns no membership until something provisions one,
    // and their first request may well be a mutation. Provisioning here keeps
    // that click from failing with a role error it would have passed a moment
    // later. The one route that must not provision, accepting an invitation,
    // carries no decorator and never reaches this far.
    const membership =
      (await this.workspaces.membershipFor(claims.id)) ??
      (await this.workspaces.primaryFor(claims));

    if (required && required.length > 0) {
      const minimum = Math.min(...required.map((needed) => ROLE_RANK[needed]));

      if (ROLE_RANK[membership.role] < minimum) {
        throw new ForbiddenException({
          code: "ROLE_REQUIRED",
          message:
            minimum >= ROLE_RANK.OWNER
              ? "Only the workspace owner can do this."
              : "Your role in this workspace does not allow this.",
        });
      }
    }

    if (module && membership.role !== "OWNER") {
      const allowed = await this.workspaces.modulesFor(
        membership.workspaceId,
        membership.role,
      );

      if (!allowed.includes(module)) {
        throw new ForbiddenException({
          code: "MODULE_DISABLED",
          message: `The workspace owner has not enabled ${MODULE_LABELS[module]} for your role.`,
        });
      }
    }

    return true;
  }
}
