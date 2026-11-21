import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { CreateTemplateDto } from "./dto/create-template.dto";
import { TemplatesService } from "./templates.service";

/**
 * The templates surface. Both routes are scoped to the caller's workspace, so
 * one customer can never read or submit into another's Meta account.
 */
@Controller("v1/templates")
@UseGuards(SupabaseAuthGuard)
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
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(@CurrentUser() claims: AuthClaims, @Body() dto: CreateTemplateDto) {
    return this.templates.create(claims, dto);
  }
}
