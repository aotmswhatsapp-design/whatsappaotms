import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WhatsAppModule } from "../whatsapp/whatsapp.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";

/**
 * The same three imports every Meta-facing module needs: the guard, the
 * tenant, and the Graph client with the key to the stored token. WhatsAppModule
 * re-exports them so there is one HTTP client for Meta, not one per module.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, WhatsAppModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
