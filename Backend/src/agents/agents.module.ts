import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthModule } from "../auth/auth.module";
import { InboxModule } from "../inbox/inbox.module";
import { MEDIA_BUCKET, MediaStorage } from "../inbox/media.storage";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AgentsController } from "./agents.controller";
import { AgentsRunner } from "./agents.runner";
import { AgentsService } from "./agents.service";
import { AgentRouter } from "./agent.router";
import { AiController } from "./ai.controller";
import { OpenAiMediaExtractor } from "./extract.media";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";
import { OpenAiProvider } from "./ai.openai";
import { RetrievalService } from "./retrieval.service";
import { ReplyIntake } from "./reply.intake";
import { ReplyService } from "./reply.service";
import { LocalKnowledgeSearch } from "./search/local.search";
import { KNOWLEDGE_SEARCH } from "./search/search.port";
import { VectorKnowledgeSearch } from "./search/vector.search";

/**
 * AuthModule supplies the guard, WorkspacesModule the tenant, and InboxModule
 * the sender `ReplyService` answers through. Everything else is this module's
 * own. The agents run in this process on a timer, so there is no client to
 * share and no queue to reach.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, InboxModule],
  controllers: [AgentsController, KnowledgeController, AiController],
  providers: [
    AgentsService,
    KnowledgeService,
    RetrievalService,
    AgentRouter,
    ReplyIntake,
    ReplyService,
    AgentsRunner,
    OpenAiProvider,
    OpenAiMediaExtractor,
    LocalKnowledgeSearch,
    VectorKnowledgeSearch,
    {
      // One engine per process, chosen by configuration. Both are built so the
      // choice is a value rather than a code path, and neither is asked for a
      // key until it is used.
      provide: KNOWLEDGE_SEARCH,
      inject: [ConfigService, LocalKnowledgeSearch, VectorKnowledgeSearch],
      useFactory: (
        config: ConfigService,
        local: LocalKnowledgeSearch,
        vector: VectorKnowledgeSearch,
      ) => (config.get<string>("KNOWLEDGE_SEARCH") === "vector" ? vector : local),
    },
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
