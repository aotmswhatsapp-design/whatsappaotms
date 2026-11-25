import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { Roles } from "../workspaces/workspace-roles.decorator";
import { WorkspaceRolesGuard } from "../workspaces/workspace-roles.guard";
import { CampaignsService } from "./campaigns.service";
import { AddRecipientsDto } from "./dto/add-recipients.dto";
import { CreateCampaignDto } from "./dto/create-campaign.dto";
import { AudienceQueryDto, ListCampaignsDto } from "./dto/list-campaigns.dto";
import { TestCampaignDto } from "./dto/test-campaign.dto";
import { UpdateCampaignDto } from "./dto/update-campaign.dto";

/**
 * The campaigns' HTTP surface.
 *
 * These are AOTMS campaigns sent through the WhatsApp Cloud API. Meta's
 * "Messaging campaigns in Meta Business Suite" is a different product with no
 * API, so nothing here can read or mirror one.
 *
 * Routes that resolve a workspace from the token are declared before `:id`, so
 * `options` and `audience` are never read as campaign ids.
 */
@Controller("v1/campaigns")
@UseGuards(SupabaseAuthGuard, WorkspaceRolesGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  /** GET /api/v1/campaigns — newest first, optional `?status=`. */
  @Get()
  list(@CurrentUser() claims: AuthClaims, @Query() query: ListCampaignsDto) {
    return this.campaigns.list(claims, query);
  }

  /** GET /api/v1/campaigns/options — approved templates, tags, number state. */
  @Get("options")
  options(@CurrentUser() claims: AuthClaims) {
    return this.campaigns.options(claims);
  }

  /**
   * GET /api/v1/campaigns/audience?tags=a,b — the live matched count, so the
   * form can say how many contacts this will reach before it is saved.
   */
  @Get("audience")
  audience(
    @CurrentUser() claims: AuthClaims,
    @Query() query: AudienceQueryDto,
  ) {
    return this.campaigns.audience(claims, query.tags ?? []);
  }

  /** POST /api/v1/campaigns — a draft, or a scheduled campaign. */
  @Post()
  @Roles("ADMIN")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  create(@CurrentUser() claims: AuthClaims, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(claims, dto);
  }

  /** GET /api/v1/campaigns/:id — the campaign, insights, first recipients. */
  @Get(":id")
  detail(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.campaigns.detail(claims, id, cursor);
  }

  /** PATCH /api/v1/campaigns/:id — a draft or a scheduled campaign only. */
  @Patch(":id")
  @Roles("ADMIN")
  update(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaigns.update(claims, id, dto);
  }

  /** DELETE /api/v1/campaigns/:id — a draft or a scheduled campaign only. */
  @Delete(":id")
  @Roles("ADMIN")
  remove(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.campaigns.remove(claims, id);
  }

  /**
   * POST /api/v1/campaigns/:id/recipients — add numbers to a draft's list,
   * by hand or from a spreadsheet. Duplicates come back in the report.
   */
  @Post(":id/recipients")
  @Roles("ADMIN")
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  addRecipients(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AddRecipientsDto,
  ) {
    return this.campaigns.addRecipients(claims, id, dto);
  }

  /** DELETE /api/v1/campaigns/:id/recipients/:recipientId — before the send. */
  @Delete(":id/recipients/:recipientId")
  @Roles("ADMIN")
  removeRecipient(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("recipientId", ParseUUIDPipe) recipientId: string,
  ) {
    return this.campaigns.removeRecipient(claims, id, recipientId);
  }

  /** POST /api/v1/campaigns/:id/start — snapshot the audience and begin. */
  @Post(":id/start")
  @Roles("ADMIN")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  start(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.campaigns.start(claims, id);
  }

  @Post(":id/pause")
  @Roles("ADMIN")
  @HttpCode(200)
  pause(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.campaigns.pause(claims, id);
  }

  @Post(":id/resume")
  @Roles("ADMIN")
  @HttpCode(200)
  resume(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.campaigns.resume(claims, id);
  }

  @Post(":id/cancel")
  @Roles("ADMIN")
  @HttpCode(200)
  cancel(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.campaigns.cancel(claims, id);
  }

  /**
   * POST /api/v1/campaigns/:id/test — one real send to one number. It is not a
   * recipient and is not counted.
   */
  @Post(":id/test")
  @Roles("ADMIN")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  test(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: TestCampaignDto,
  ) {
    return this.campaigns.test(claims, id, dto);
  }

  /** GET /api/v1/campaigns/:id/recipients.csv — the PRD's report export. */
  @Get(":id/recipients.csv")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="recipients.csv"')
  async recipientsCsv(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const csv = await this.campaigns.recipientsCsv(claims, id);

    return new StreamableFile(Buffer.from(csv, "utf8"));
  }
}
