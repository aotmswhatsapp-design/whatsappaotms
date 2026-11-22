import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WhatsAppModule } from "../whatsapp/whatsapp.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsReportService } from "./analytics.report";
import { AnalyticsScheduler } from "./analytics.scheduler";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsSyncService } from "./analytics.sync";

/**
 * The same three imports every Meta-facing module needs: the guard, the
 * tenant, and the Graph client with the key to the stored token. WhatsAppModule
 * re-exports them so there is one HTTP client for Meta, not one per module.
 *
 * Three services, three jobs: `AnalyticsService` reads Meta live for the
 * overview, `AnalyticsSyncService` stores Meta's figures for the report, and
 * `AnalyticsReportService` reads only what was stored. Keeping the live and
 * stored paths apart is what lets the report name when it was last true.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, WhatsAppModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsSyncService,
    AnalyticsReportService,
    AnalyticsScheduler,
  ],
})
export class AnalyticsModule {}
