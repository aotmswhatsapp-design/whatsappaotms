import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from "@nestjs/common";

import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../workspaces/workspace-roles.decorator";
import { WorkspaceRolesGuard } from "../workspaces/workspace-roles.guard";
import { BotsService } from "./bots.service";
import { SaveBotDto } from "./dto/save-bot.dto";

/**
 * The flow behind one agent's chatbot.
 *
 * Reading is open to every member — the Inbox offers these cards to whoever is
 * working the thread — while writing is the owner's, because it changes what a
 * customer is shown.
 */
@Controller("v1/agents/:agentId/bot")
@UseGuards(SupabaseAuthGuard, WorkspaceRolesGuard)
export class BotsController {
  constructor(private readonly bots: BotsService) {}

  /** GET /api/v1/agents/:agentId/bot — an empty flow when none was written yet. */
  @Get()
  read(
    @CurrentUser() claims: AuthClaims,
    @Param("agentId", ParseUUIDPipe) agentId: string,
  ) {
    return this.bots.read(claims, agentId);
  }

  /** PUT /api/v1/agents/:agentId/bot — the whole flow, replacing the stored one. */
  @Put()
  @Roles("OWNER")
  save(
    @CurrentUser() claims: AuthClaims,
    @Param("agentId", ParseUUIDPipe) agentId: string,
    @Body() dto: SaveBotDto,
  ) {
    return this.bots.save(claims, agentId, dto);
  }
}
