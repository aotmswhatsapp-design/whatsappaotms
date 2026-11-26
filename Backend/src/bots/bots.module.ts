import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
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
 */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [BotsController],
  providers: [BotsService, BotStore],
  exports: [BotsService, BotStore],
})
export class BotsModule {}
