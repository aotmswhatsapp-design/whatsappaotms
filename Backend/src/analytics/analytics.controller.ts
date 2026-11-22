import { Controller, Get, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { SyncTrigger } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { AnalyticsReportService } from "./analytics.report";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsSyncService } from "./analytics.sync";

/**
 * The analytics routes. Scoped to the caller's workspace, so the numbers come
 * from that workspace's own Meta account and nowhere else.
 */
@Controller("v1/analytics")
@UseGuards(SupabaseAuthGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly report: AnalyticsReportService,
    private readonly sync: AnalyticsSyncService,
  ) {}

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

  /**
   * GET /api/v1/analytics/report — Meta's figures as they were stored.
   *
   * `from` and `to` are whole UTC days (`YYYY-MM-DD`), and `category` narrows
   * the template table to MARKETING, UTILITY or AUTHENTICATION. The window is
   * capped at ninety days because that is all Meta keeps: a wider filter would
   * promise history nobody has.
   */
  @Get("report")
  reportOf(
    @CurrentUser() claims: AuthClaims,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("category") category?: string,
  ) {
    return this.report.report(claims, { from, to, category });
  }

  /**
   * POST /api/v1/analytics/sync — the Sync button.
   *
   * Throttled rather than queued: a run reads a fixed ninety-day window, so
   * three presses a minute is already more than the data can change.
   */
  @Post("sync")
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  runSync(@CurrentUser() claims: AuthClaims) {
    return this.sync.syncFor(claims, SyncTrigger.MANUAL);
  }
}
