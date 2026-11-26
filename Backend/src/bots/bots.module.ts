import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthModule } from "../auth/auth.module";
import { MediaStorage } from "../inbox/media.storage";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { BotsController } from "./bots.controller";
import { BotsService } from "./bots.service";
import { BotStore } from "./bot.store";

/**
 * The chatbot's stored flows.
 *
 * Separate from `AgentsModule` because the card model, the renderer and the tap
 * router are pure functions with no dependencies — they stay importable without
 * a container — and only the store needs a database and a tenant. `BotStore` is
 * exported because the reply worker reads a flow to answer a keyword rule.
 *
 * Card pictures get their own bucket, instantiated here rather than through
 * `MEDIA_BUCKET`, because this one has to be public: the URL is stored on the
 * card and fetched by Meta, not by a signed-in browser.
 */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [BotsController],
  providers: [
    BotsService,
    BotStore,
    {
      provide: MediaStorage,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new MediaStorage(config, {
          name: config.get<string>("BOT_MEDIA_BUCKET") ?? "bot-media",
          public: true,
        }),
    },
  ],
  exports: [BotsService, BotStore],
})
export class BotsModule {}
