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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import type { UploadedMedia } from "../inbox/inbox.sender";
import { AddTextSourceDto } from "./dto/add-text-source.dto";
import { KnowledgeService, MAX_SOURCE_BYTES } from "./knowledge.service";

/**
 * Training material for one agent. A source is indexed in the background, so
 * every route here answers immediately with `PENDING` and the screen polls the
 * list while the runner works.
 */
@Controller("v1/agents/:id/sources")
@UseGuards(SupabaseAuthGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  /** GET /api/v1/agents/:id/sources — newest first, every status. */
  @Get()
  list(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.knowledge.list(claims, id);
  }

  /** POST /api/v1/agents/:id/sources/text — a typed note or pasted policy. */
  @Post("text")
  addText(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AddTextSourceDto,
  ) {
    return this.knowledge.addText(claims, id, dto);
  }

  /**
   * POST /api/v1/agents/:id/sources/file — multipart, field `file`.
   *
   * The type is decided by the extension, not the browser's mimetype: the
   * extractor switches on it, and a phone that sends `application/octet-stream`
   * must still index.
   */
  @Post("file")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_SOURCE_BYTES } }),
  )
  addFile(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedMedia | undefined,
  ) {
    if (!file) {
      // Without this the service would store an empty buffer and index nothing.
      throw new BadRequestException("Attach a file to train on.");
    }

    return this.knowledge.addFile(claims, id, file);
  }

  /** DELETE /api/v1/agents/:id/sources/:sourceId — the row, chunks and bytes. */
  @Delete(":sourceId")
  remove(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("sourceId", ParseUUIDPipe) sourceId: string,
  ) {
    return this.knowledge.remove(claims, id, sourceId);
  }

  /** POST /api/v1/agents/:id/sources/:sourceId/retry — back to PENDING. */
  @Post(":sourceId/retry")
  @HttpCode(200)
  retry(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("sourceId", ParseUUIDPipe) sourceId: string,
  ) {
    return this.knowledge.retry(claims, id, sourceId);
  }
}
