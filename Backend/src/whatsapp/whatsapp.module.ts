import { Module } from "@nestjs/common";

import { AgentsModule } from "../agents/agents.module";
import { AuthModule } from "../auth/auth.module";
import { SecretBox } from "../common/crypto/secret-box";
import { CrmModule } from "../crm/crm.module";
import { InboxModule } from "../inbox/inbox.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { MetaGraph } from "./meta-graph";
import { WhatsAppController } from "./whatsapp.controller";
import { WhatsAppService } from "./whatsapp.service";
import { WhatsAppWebhookController } from "./whatsapp-webhook.controller";
import { WhatsAppWebhookService } from "./whatsapp-webhook.service";

@Module({
  // AuthModule supplies the guard, WorkspacesModule the tenant the account is
  // owned by, InboxModule the store a delivery is persisted into, and CrmModule
  // the intake that reads the message it just stored.
  imports: [AuthModule, WorkspacesModule, InboxModule, AgentsModule, CrmModule],
  // The webhook controller must come from this module even though it has no
  // guard: it needs SecretBox, and one module means one place to look.
  controllers: [WhatsAppController, WhatsAppWebhookController],
  providers: [WhatsAppService, WhatsAppWebhookService, MetaGraph, SecretBox],
  // Templates talk to the same Graph API and open the same stored secrets, so
  // they consume these two rather than building a second client that drifts.
  exports: [MetaGraph, SecretBox],
})
export class WhatsAppModule {}
