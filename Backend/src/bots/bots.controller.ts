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
import {
  RequiresModule,
  Roles,
} from "../workspaces/workspace-roles.decorator";
import { WorkspaceRolesGuard } from "../workspaces/workspace-roles.guard";
import { MAX_CARD_FILE_BYTES } from "./bot.limits";
import { BotsService, type UploadedBotImage } from "./bots.service";
import { SaveBotDto } from "./dto/save-bot.dto";
import { ShiftCardsDto } from "./dto/shift-cards.dto";

/**
 * The flow behind one agent's chatbot.
 *
 * Reading is open to every member — the Inbox offers these cards to whoever is
 * working the thread — while writing is the owner's, because it changes what a
 * customer is shown. For that reason the `chatbot` module gate sits on the
 * writes only: shutting the editor to a role must not take the cards out of
 * an inbox that role is allowed to work.
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
  @RequiresModule("chatbot")
  @Roles("OWNER")
  save(
    @CurrentUser() claims: AuthClaims,
    @Param("agentId", ParseUUIDPipe) agentId: string,
    @Body() dto: SaveBotDto,
  ) {
    return this.bots.save(claims, agentId, dto);
  }

  /**
   * POST /api/v1/agents/:agentId/bot/shift — carries cards to another agent.
   *
   * Its own route rather than two PUTs from the screen: the target's flow is
   * read on this side, and the repairs that keep both flows valid belong beside
   * the validation that refuses them. Owner-only, like saving: it changes what
   * a customer of either agent is shown.
   *
   * Answers 200 with the source flow already stored — nothing new has an
   * address of its own, the cards simply live in the other agent's flow now.
   */
  @Post("shift")
  @RequiresModule("chatbot")
  @Roles("OWNER")
  @HttpCode(200)
  shift(
    @CurrentUser() claims: AuthClaims,
    @Param("agentId", ParseUUIDPipe) agentId: string,
    @Body() dto: ShiftCardsDto,
  ) {
    return this.bots.shift(claims, agentId, dto);
  }

  /**
   * POST /api/v1/agents/:agentId/bot/media — multipart, field `file`.
   *
   * Answers the permanent address of the stored picture or file, which the
   * builder writes into the card it is editing. Owner-only, like saving the
   * flow: an upload changes what a customer is shown.
   *
   * One route for both because the browser picks the file, not the screen: the
   * type it declares decides whether the bytes are re-encoded as a picture or
   * kept as a document, and the answer says which it became.
   */
  @Post("media")
  @RequiresModule("chatbot")
  @Roles("OWNER")
  @HttpCode(201)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(
    // The larger of the two ceilings: the service refuses an oversized picture
    // or video by its own limit, which the interceptor cannot know yet.
    FileInterceptor("file", { limits: { fileSize: MAX_CARD_FILE_BYTES } }),
  )
  uploadMedia(
    @CurrentUser() claims: AuthClaims,
    @Param("agentId", ParseUUIDPipe) agentId: string,
    @UploadedFile() file: UploadedBotImage | undefined,
  ) {
    if (!file) {
      // Without this the service would inspect an empty buffer and blame the
      // file type, which is not what went wrong.
      throw new BadRequestException("Choose a picture or a file to upload.");
    }

    return this.bots.uploadMedia(claims, agentId, file);
  }

  /**
   * GET /api/v1/agents/:agentId/bot/media — pictures and files already uploaded
   * for this agent, newest first, so a card can reuse one instead of uploading
   * twice.
   */
  @Get("media")
  library(
    @CurrentUser() claims: AuthClaims,
    @Param("agentId", ParseUUIDPipe) agentId: string,
  ) {
    return this.bots.mediaLibrary(claims, agentId);
  }

  /**
   * DELETE /api/v1/agents/:agentId/bot/media?path=… — removes one uploaded
   * picture or file from storage, for good.
   *
   * The path travels as a query parameter rather than a body: a DELETE body is
   * dropped by some proxies in front of this API, and the path is short. A
   * missing one is answered by the service like any other unknown path.
   * Owner-only, like the upload: removing an upload changes what a customer can
   * be shown.
   */
  @Delete("media")
  @RequiresModule("chatbot")
  @Roles("OWNER")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  removeMedia(
    @CurrentUser() claims: AuthClaims,
    @Param("agentId", ParseUUIDPipe) agentId: string,
    @Query("path") path?: string,
  ) {
    return this.bots.removeMedia(claims, agentId, path ?? "");
  }
}
