import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { SecretBox } from "../common/crypto/secret-box";
import { MetaGraph } from "./meta-graph";
import { WhatsAppController } from "./whatsapp.controller";
import { WhatsAppService } from "./whatsapp.service";
import { WhatsAppWebhookController } from "./whatsapp-webhook.controller";
import { WhatsAppWebhookService } from "./whatsapp-webhook.service";

@Module({
  // AuthModule supplies the guard plus UsersService, which is what creates the
  // `users` row the connection hangs off.
  imports: [AuthModule],
  // The webhook controller must come from this module even though it has no
  // guard: it needs SecretBox, and one module means one place to look.
  controllers: [WhatsAppController, WhatsAppWebhookController],
  providers: [WhatsAppService, WhatsAppWebhookService, MetaGraph, SecretBox],
})
export class WhatsAppModule {}
