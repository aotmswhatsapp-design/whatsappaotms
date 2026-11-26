import {
  BadRequestException,
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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { RequiresModule, Roles } from "../workspaces/workspace-roles.decorator";
import { WorkspaceRolesGuard } from "../workspaces/workspace-roles.guard";
import { CreateTemplateDto } from "./dto/create-template.dto";
import { UpdateTemplateDto } from "./dto/update-template.dto";
import { MAX_IMAGE_BYTES } from "./template-media";
import { TemplatesService, type UploadedTemplateImage } from "./templates.service";

/**
 * The templates surface. Both routes are scoped to the caller's workspace, so
 * one customer can never read or submit into another's Meta account.
 *
 * Only the management half — submit, edit, delete, enable insights — sits
 * behind the `templates` module. Reading the catalogue does not: the inbox
 * composer and the campaign builder both need an approved template to send,
 * and an Agent who may answer a customer must not be refused the list of
 * messages they are allowed to answer with.
 */
@Controller("v1/templates")
@UseGuards(SupabaseAuthGuard, WorkspaceRolesGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  /**
   * GET /api/v1/templates — the cache, refreshed from Meta when it is older
   * than a minute. `?refresh=1` forces the round trip (the Refresh button).
   * A Meta failure answers 200 with `stale: true` and the reason, because the
   * list itself is still real.
   */
  @Get()
  list(@CurrentUser() claims: AuthClaims, @Query("refresh") refresh?: string) {
    return this.templates.list(claims, refresh === "1" || refresh === "true");
  }

  /**
   * POST /api/v1/templates — submit a draft to Meta and store the verdict.
   * 201 with the row Meta created, or 400 listing every field to fix, or 502
   * carrying Meta's own sentence when it refused the template itself.
   */
  @Post()
  @RequiresModule("templates")
  @Roles("ADMIN")
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(@CurrentUser() claims: AuthClaims, @Body() dto: CreateTemplateDto) {
    return this.templates.create(claims, dto);
  }

  /**
   * POST /api/v1/templates/media — multipart, field `file`, optional `name`.
   * Stores the sample in the private bucket and answers the path the create
   * call names, plus a signed URL the builder paints immediately.
   */
  @Post("media")
  @RequiresModule("templates")
  @Roles("ADMIN")
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  uploadMedia(
    @CurrentUser() claims: AuthClaims,
    @UploadedFile() file: UploadedTemplateImage | undefined,
    @Body("name") name?: string,
  ) {
    if (!file) {
      // Without this the service would inspect an empty buffer and blame the
      // file type, which is not what went wrong.
      throw new BadRequestException("Choose an image to upload.");
    }

    return this.templates.uploadMedia(claims, file, name);
  }

  /**
   * GET /api/v1/templates/:id/media — a five-minute signed URL for the stored
   * sample. A template from another workspace answers 404 like a missing one.
   */
  @Get(":id/media")
  media(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.templates.mediaUrl(claims, id);
  }

  /**
   * GET /api/v1/templates/:id/analytics?days=30 — spend, performance and the
   * daily series. A Meta failure answers 200 with the local half intact and
   * `unavailable` naming what is missing.
   */
  @Get(":id/analytics")
  analytics(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("days") days?: string,
  ) {
    const parsed = days === undefined ? undefined : Number(days);

    return this.templates.analytics(
      claims,
      id,
      parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
    );
  }

  /**
   * POST /api/v1/templates/insights — switches Meta's per-template insights on
   * for the WABA. One-way, which is why the screen asks before calling it.
   */
  @Post("insights")
  @RequiresModule("templates")
  @Roles("ADMIN")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  enableInsights(@CurrentUser() claims: AuthClaims) {
    return this.templates.enableInsights(claims);
  }

  /**
   * GET /api/v1/templates/performance?days=30 — delivered count and spend for
   * every template, for the catalogue list. Declared before `:id` so the path
   * is not read as a template id. A Meta refusal answers 200 with null figures
   * and the reason; the list itself does not depend on it.
   */
  @Get("performance")
  performance(
    @CurrentUser() claims: AuthClaims,
    @Query("days") days?: string,
  ) {
    const parsed = days === undefined ? undefined : Number(days);

    return this.templates.performance(
      claims,
      parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
    );
  }

  /** GET /api/v1/templates/:id — one row, scoped to the caller's workspace. */
  @Get(":id")
  find(@CurrentUser() claims: AuthClaims, @Param("id", ParseUUIDPipe) id: string) {
    return this.templates.find(claims, id);
  }

  /**
   * PATCH /api/v1/templates/:id — edit a template at Meta and write the new
   * content over the cache. 200 with the row, 400 when the template's review
   * state or one of Meta's fixed fields blocks the change, or 502 carrying
   * Meta's own sentence when it refused the content.
   */
  @Patch(":id")
  @RequiresModule("templates")
  @Roles("ADMIN")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  update(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templates.update(claims, id, dto);
  }

  /**
   * DELETE /api/v1/templates/:id — delete this language at Meta and hide the
   * row here. 200 `{ removed: true }`; a disabled template answers 400 with
   * the reason, and a Meta refusal answers 502 with its sentence.
   */
  @Delete(":id")
  @RequiresModule("templates")
  @Roles("ADMIN")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  remove(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.templates.remove(claims, id);
  }
}
