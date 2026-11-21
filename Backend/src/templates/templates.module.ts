import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WhatsAppModule } from "../whatsapp/whatsapp.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { TemplatesController } from "./templates.controller";
import { TemplatesService } from "./templates.service";

/**
 * AuthModule supplies the guard, WorkspacesModule the tenant, and WhatsAppModule
 * the two things every Graph call needs: the client and the key that opens the
 * stored access token. Re-exporting them there keeps one HTTP client for Meta
 * rather than a second one that drifts.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, WhatsAppModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
