import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { RequiresModule, Roles } from "../workspaces/workspace-roles.decorator";
import { WorkspaceRolesGuard } from "../workspaces/workspace-roles.guard";
import { BusinessService } from "./business.service";
import { UpdateBusinessProfileDto } from "./dto/update-business-profile.dto";

@Controller("v1/business")
@RequiresModule("profile")
@UseGuards(SupabaseAuthGuard, WorkspaceRolesGuard)
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  /**
   * GET /api/v1/business/profile — the workspace's own details, with defaults
   * when nothing has been saved yet. Never creates the row.
   */
  @Get("profile")
  profile(@CurrentUser() claims: AuthClaims) {
    return this.business.read(claims);
  }

  /**
   * PATCH /api/v1/business/profile — partial update, so a form that changed one
   * field does not have to resend the rest. Creating on first save keeps the
   * read path write-free.
   */
  @Patch("profile")
  @Roles("OWNER")
  update(
    @CurrentUser() claims: AuthClaims,
    @Body() dto: UpdateBusinessProfileDto,
  ) {
    return this.business.update(claims, dto);
  }
}
