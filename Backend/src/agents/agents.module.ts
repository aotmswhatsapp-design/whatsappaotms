import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthModule } from "../auth/auth.module";
import { BotsModule } from "../bots/bots.module";
import { InboxModule } from "../inbox/inbox.module";
import { MEDIA_BUCKET, MediaStorage } from "../inbox/media.storage";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AgentsController } from "./agents.controller";
import { AgentsRunner } from "./agents.runner";
import { AgentsService } from "./agents.service";
import { AgentRouter } from "./agent.router";
import { AiController } from "./ai.controller";
import { OpenRouter } from "./ai.openrouter";
import { DocumentsService } from "./documents/documents.service";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";
import { RetrievalService } from "./retrieval.service";
import { ReplyIntake } from "./reply.intake";
import { ReplyService } from "./reply.service";
import { LocalKnowledgeSearch } from "./search/local.search";

/**
 * AuthModule supplies the guard, WorkspacesModule the tenant, and InboxModule
 * the sender `ReplyService` answers through. BotsModule lends the flow store, so
 * a keyword rule can answer a card without a second copy of that SQL. Everything
 * else is this module's own. The agents run in this process on a timer, so there
 * is no client to share and no queue to reach.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, InboxModule, BotsModule],
  controllers: [AgentsController, KnowledgeController, AiController],
  providers: [
    AgentsService,
    KnowledgeService,
    RetrievalService,
    DocumentsService,
    AgentRouter,
    ReplyIntake,
    ReplyService,
    AgentsRunner,
    LocalKnowledgeSearch,
    MediaStorage,
    OpenRouter,
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
