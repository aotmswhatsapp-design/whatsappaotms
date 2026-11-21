import { Controller, Get, Query, UseGuards } from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { AnalyticsService } from "./analytics.service";

/**
 * The Overview screen's one route. Scoped to the caller's workspace, so the
 * numbers come from that workspace's own Meta account and nowhere else.
 */
@Controller("v1/analytics")
@UseGuards(SupabaseAuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * GET /api/v1/analytics/overview — live Meta reads, cached for a minute.
   * `?refresh=1` forces the round trip (the Refresh button). A read Meta
   * refuses leaves its section null with the reason in `unavailable`; the
   * other sections are still answered.
   */
  @Get("overview")
  overview(@CurrentUser() claims: AuthClaims, @Query("refresh") refresh?: string) {
    return this.analytics.overview(claims, refresh === "1" || refresh === "true");
  }
}
