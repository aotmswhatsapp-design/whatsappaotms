import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { AgentsModule } from "./agents/agents.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AuthModule } from "./auth/auth.module";
import { BusinessModule } from "./business/business.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { validateEnv } from "./config/env";
import { HealthModule } from "./health/health.module";
import { InboxModule } from "./inbox/inbox.module";
import { PrismaModule } from "./prisma/prisma.module";
import { TemplatesModule } from "./templates/templates.module";
import { WhatsAppModule } from "./whatsapp/whatsapp.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      validate: validateEnv,
    }),
    // A blunt per-IP ceiling, tunable per deployment. Endpoints that can be
    // used to harass a third party (auth mail) declare a tighter limit of their
    // own with @Throttle.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>("THROTTLE_TTL_MS") ?? 60_000,
          limit: config.get<number>("THROTTLE_LIMIT") ?? 120,
        },
      ],
    }),
    PrismaModule,
    AgentsModule,
    AuthModule,
    WhatsAppModule,
    BusinessModule,
    InboxModule,
    CampaignsModule,
    TemplatesModule,
    AnalyticsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
