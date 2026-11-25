import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import {
  AcceptInvitationDto,
  ChangeMemberRoleDto,
  InviteMemberDto,
} from "./dto/team.dto";
import { Roles } from "./workspace-roles.decorator";
import { WorkspaceRolesGuard } from "./workspace-roles.guard";
import { WorkspacesService } from "./workspaces.service";

/**
 * The team module: who is on the workspace and who may join it.
 *
 * Reading the team is open to every member — an agent should know who they
 * work with. Changing it is the owner's alone, which is what the PRD gives the
 * Business Owner and withholds from the Manager.
 */
@Controller("v1/workspaces")
@UseGuards(SupabaseAuthGuard, WorkspaceRolesGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  /** GET /api/v1/workspaces — the workspace, its members and pending invites. */
  @Get()
  view(@CurrentUser() claims: AuthClaims) {
    return this.workspaces.view(claims);
  }

  /**
   * POST /api/v1/workspaces/invitations — creates a link and returns its token
   * once. The screen shows it to the owner to pass on; the database keeps only
   * the hash, so this is the only time it exists.
   */
  @Post("invitations")
  @Roles("OWNER")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  invite(@CurrentUser() claims: AuthClaims, @Body() dto: InviteMemberDto) {
    return this.workspaces.invite(claims, dto);
  }

  /** DELETE /api/v1/workspaces/invitations/:id — withdraws a pending invite. */
  @Delete("invitations/:id")
  @Roles("OWNER")
  revoke(@CurrentUser() claims: AuthClaims, @Param("id") id: string) {
    return this.workspaces.revoke(claims, id);
  }

  /**
   * POST /api/v1/workspaces/invitations/accept — joins the workspace the link
   * names. No role guard: the caller has no membership here yet, and the
   * invitation is the proof.
   */
  @Post("invitations/accept")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  accept(@CurrentUser() claims: AuthClaims, @Body() dto: AcceptInvitationDto) {
    return this.workspaces.accept(claims, dto.token);
  }

  /** PATCH /api/v1/workspaces/members/:userId — change a role between ADMIN and AGENT. */
  @Patch("members/:userId")
  @Roles("OWNER")
  changeRole(
    @CurrentUser() claims: AuthClaims,
    @Param("userId") userId: string,
    @Body() dto: ChangeMemberRoleDto,
  ) {
    return this.workspaces.changeRole(claims, userId, dto.role);
  }

  /** DELETE /api/v1/workspaces/members/:userId — remove someone from the team. */
  @Delete("members/:userId")
  @Roles("OWNER")
  remove(@CurrentUser() claims: AuthClaims, @Param("userId") userId: string) {
    return this.workspaces.remove(claims, userId);
  }
}
