import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthModule } from "../auth/auth.module";
import { MEDIA_BUCKET, MediaStorage } from "../inbox/media.storage";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AgentsController } from "./agents.controller";
import { AgentsService } from "./agents.service";
import { OpenAiMediaExtractor } from "./extract.media";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";
import { OpenAiProvider } from "./ai.openai";
import { RetrievalService } from "./retrieval.service";
import { ReplyIntake } from "./reply.intake";

/**
 * AuthModule supplies the guard, WorkspacesModule the tenant, and everything
 * else is this module's own. The agents run in this process on a timer, so
 * there is no client to share and no queue to reach.
 */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [AgentsController, KnowledgeController],
  providers: [
    AgentsService,
    KnowledgeService,
    RetrievalService,
    ReplyIntake,
    OpenAiProvider,
    OpenAiMediaExtractor,
    MediaStorage,
    {
      provide: MEDIA_BUCKET,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>("AGENT_SOURCE_BUCKET") ?? "agent-sources",
    },
  ],
  exports: [AgentsService, KnowledgeService, ReplyIntake],
})
export class AgentsModule {}
