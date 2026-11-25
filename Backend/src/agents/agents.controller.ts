import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { Roles } from "../workspaces/workspace-roles.decorator";
import { WorkspaceRolesGuard } from "../workspaces/workspace-roles.guard";
import { AgentsService } from "./agents.service";
import { AskAgentDto } from "./dto/ask-agent.dto";
import { CreateAgentDto } from "./dto/create-agent.dto";
import { ListRunsDto } from "./dto/list-runs.dto";
import { UpdateAgentDto } from "./dto/update-agent.dto";

/**
 * The agents' HTTP surface. Nothing here sends a WhatsApp message: replies are
 * produced by the runner from queued runs, and the playground deliberately
 * answers without touching the wire.
 */
@Controller("v1/agents")
@UseGuards(SupabaseAuthGuard, WorkspaceRolesGuard)
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  /** GET /api/v1/agents — every agent, oldest first, with ready-source counts. */
  @Get()
  list(@CurrentUser() claims: AuthClaims) {
    return this.agents.list(claims);
  }

  /** POST /api/v1/agents — a draft agent. It is not active until activated. */
  @Post()
  @Roles("OWNER")
  create(@CurrentUser() claims: AuthClaims, @Body() dto: CreateAgentDto) {
    return this.agents.create(claims, dto);
  }

  /** GET /api/v1/agents/:id — the agent, its sources and recent runs. */
  @Get(":id")
  detail(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.agents.detail(claims, id);
  }

  /**
   * PATCH /api/v1/agents/:id — prompt, model, temperature, keywords.
   *
   * Activation is not part of this route even though the DTO accepts and
   * ignores `isActive`: two ways to turn an agent on would each need their own
   * guard, and only `POST /activate` checks that a source is ready.
   */
  @Patch(":id")
  @Roles("OWNER")
  update(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgentDto,
  ) {
    return this.agents.update(claims, id, dto);
  }

  /** DELETE /api/v1/agents/:id — the agent, its sources and its runs. */
  @Delete(":id")
  @Roles("OWNER")
  remove(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.agents.remove(claims, id);
  }

  /**
   * POST /api/v1/agents/:id/activate — put this agent on duty for the number.
   *
   * Several agents may be on duty at once: a new conversation is routed to the
   * one whose description fits it. Turning one on no longer switches another
   * off, which is why a second agent needs a description.
   *
   * 409 `AGENT_UNTRAINED` while no source is READY: an active agent that knows
   * nothing would answer every message with a handoff. 409 `AGENT_UNDESCRIBED`
   * when another agent is already on duty and this one has no description to be
   * routed by.
   */
  @Post(":id/activate")
  @Roles("OWNER")
  @HttpCode(200)
  activate(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.agents.activate(claims, id);
  }

  /**
   * POST /api/v1/agents/:id/deactivate — the activation switch's off position.
   *
   * There is no `isActive` field on PATCH on purpose: turning an agent on has a
   * precondition (a READY source) and lives on its own route, so turning one
   * off does too.
   */
  @Post(":id/deactivate")
  @Roles("OWNER")
  @HttpCode(200)
  deactivate(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.agents.deactivate(claims, id);
  }

  /**
   * POST /api/v1/agents/:id/ask — the playground. Costs tokens, sends nothing,
   * and records a PLAYGROUND run so the usage screen sees it.
   */
  @Post(":id/ask")
  @Roles("OWNER")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  ask(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AskAgentDto,
  ) {
    return this.agents.ask(claims, id, dto);
  }

  /** GET /api/v1/agents/:id/runs — the Activity tab, newest first, paged. */
  @Get(":id/runs")
  runs(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ListRunsDto,
  ) {
    return this.agents.runs(claims, id, query);
  }
}
