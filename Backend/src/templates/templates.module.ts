import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WhatsAppModule } from "../whatsapp/whatsapp.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { TemplateMediaModule } from "./template-media.module";
import { TemplatesController } from "./templates.controller";
import { TemplatesService } from "./templates.service";

/**
 * AuthModule supplies the guard, WorkspacesModule the tenant, and WhatsAppModule
 * the two things every Graph call needs: the client and the key that opens the
 * stored access token. Re-exporting them there keeps one HTTP client for Meta
 * rather than a second one that drifts.
 *
 * TemplateMediaModule owns the sample bucket, so the upload here and the link
 * a send mints later are the same object path in the same bucket.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, WhatsAppModule, TemplateMediaModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
