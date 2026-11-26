import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";

import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { MAX_IMAGE_BYTES } from "../templates/template-media";
import { Roles } from "../workspaces/workspace-roles.decorator";
import { WorkspaceRolesGuard } from "../workspaces/workspace-roles.guard";
import { BotsService, type UploadedBotImage } from "./bots.service";
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

  /**
   * POST /api/v1/agents/:agentId/bot/media — multipart, field `file`.
   *
   * Answers the permanent address of the optimised picture, which the builder
   * writes into the card it is editing. Owner-only, like saving the flow: a
   * picture changes what a customer is shown.
   */
  @Post("media")
  @Roles("OWNER")
  @HttpCode(201)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  uploadImage(
    @CurrentUser() claims: AuthClaims,
    @Param("agentId", ParseUUIDPipe) agentId: string,
    @UploadedFile() file: UploadedBotImage | undefined,
  ) {
    if (!file) {
      // Without this the service would inspect an empty buffer and blame the
      // file type, which is not what went wrong.
      throw new BadRequestException("Choose a picture to upload.");
    }

    return this.bots.uploadImage(claims, agentId, file);
  }

  /**
   * GET /api/v1/agents/:agentId/bot/media — pictures already uploaded for this
   * agent, newest first, so a card can reuse one instead of uploading twice.
   */
  @Get("media")
  library(
    @CurrentUser() claims: AuthClaims,
    @Param("agentId", ParseUUIDPipe) agentId: string,
  ) {
    return this.bots.imageLibrary(claims, agentId);
  }

  /**
   * DELETE /api/v1/agents/:agentId/bot/media?path=… — removes one uploaded
   * picture from storage, for good.
   *
   * The path travels as a query parameter rather than a body: a DELETE body is
   * dropped by some proxies in front of this API, and the path is short. A
   * missing one is answered by the service like any other unknown path.
   * Owner-only, like the upload: removing a picture changes what a customer can
   * be shown.
   */
  @Delete("media")
  @Roles("OWNER")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  removeImage(
    @CurrentUser() claims: AuthClaims,
    @Param("agentId", ParseUUIDPipe) agentId: string,
    @Query("path") path?: string,
  ) {
    return this.bots.removeImage(claims, agentId, path ?? "");
  }
}
