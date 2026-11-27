import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { RequiresModule, Roles } from "../workspaces/workspace-roles.decorator";
import { WorkspaceRolesGuard } from "../workspaces/workspace-roles.guard";
import { CrmSettingsDto, INTEREST_VALUES, ListTasksDto, SetInterestDto, UpdateTaskDto, type InterestValue } from "./crm.dto";
import { CrmService } from "./crm.service";
import { CrmSettingsService } from "./crm.settings";
import { TasksService } from "./tasks.service";

/**
 * The CRM's HTTP surface.
 *
 * Tasks sit behind `inbox`, not `crm`: an agent's own follow-ups must not need
 * the pipeline module. Every route resolves its workspace from the token, so an
 * id from another tenant answers 404 exactly like a missing one.
 */
@Controller("v1/crm")
@UseGuards(SupabaseAuthGuard, WorkspaceRolesGuard)
export class CrmController {
  constructor(
    private readonly settings: CrmSettingsService,
    private readonly tasks: TasksService,
    private readonly crm: CrmService,
  ) {}

  /** GET /api/v1/crm/pipeline — the board, grouped by derived stage. */
  @Get("pipeline")
  @RequiresModule("crm")
  pipeline(@CurrentUser() claims: AuthClaims, @Query("interest") interest?: string) {
    return this.crm.pipeline(
      claims,
      (INTEREST_VALUES as readonly string[]).includes(interest ?? "")
        ? (interest as InterestValue)
        : undefined,
    );
  }

  /**
   * PUT /api/v1/crm/conversations/:id/interest — a manager's override.
   * Intake leaves a manual stage alone for 24 hours.
   */
  @Put("conversations/:id/interest")
  @RequiresModule("crm")
  @Roles("MANAGER")
  setInterest(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetInterestDto,
  ) {
    return this.crm.setInterest(claims, id, dto.interest);
  }

  /** GET /api/v1/crm/tasks?scope=mine|all — open follow-ups, soonest first. */
  @Get("tasks")
  @RequiresModule("inbox")
  listTasks(@CurrentUser() claims: AuthClaims, @Query() query: ListTasksDto) {
    return this.tasks.list(claims, query.scope ?? "mine");
  }

  /** PATCH /api/v1/crm/tasks/:id — the deadline or the status. */
  @Patch("tasks/:id")
  @RequiresModule("inbox")
  updateTask(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(claims, id, dto);
  }

  /**
   * POST /api/v1/crm/tasks/:id/wa-link — the member's personal WhatsApp link.
   * 409 `NO_PERSONAL_NUMBER` when the owner has not set one.
   */
  @Post("tasks/:id/wa-link")
  @RequiresModule("inbox")
  waLink(@CurrentUser() claims: AuthClaims, @Param("id", ParseUUIDPipe) id: string) {
    return this.tasks.waLink(claims, id);
  }

  /** GET /api/v1/crm/settings — the owner's routing, and the roster's titles. */
  @Get("settings")
  @Roles("OWNER")
  readSettings(@CurrentUser() claims: AuthClaims) {
    return this.settings.read(claims);
  }

  /** PUT /api/v1/crm/settings — designation, the two switches, due hours. */
  @Put("settings")
  @Roles("OWNER")
  saveSettings(@CurrentUser() claims: AuthClaims, @Body() dto: CrmSettingsDto) {
    return this.settings.save(claims, dto);
  }
}
