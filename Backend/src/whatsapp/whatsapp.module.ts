import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { SecretBox } from "../common/crypto/secret-box";
import { MetaGraph } from "./meta-graph";
import { WhatsAppController } from "./whatsapp.controller";
import { WhatsAppService } from "./whatsapp.service";

@Module({
  // AuthModule supplies the guard plus UsersService, which is what creates the
  // `users` row the connection hangs off.
  imports: [AuthModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, MetaGraph, SecretBox],
})
export class WhatsAppModule {}
