import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthModule } from "../auth/auth.module";
import { MEDIA_BUCKET, MediaStorage } from "../inbox/media.storage";
import { WhatsAppModule } from "../whatsapp/whatsapp.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { TemplatesController } from "./templates.controller";
import { TemplatesService } from "./templates.service";

/**
 * AuthModule supplies the guard, WorkspacesModule the tenant, and WhatsAppModule
 * the two things every Graph call needs: the client and the key that opens the
 * stored access token. Re-exporting them there keeps one HTTP client for Meta
 * rather than a second one that drifts.
 *
 * MediaStorage is the inbox's class, given its own bucket here: a second copy of
 * that REST code would drift, and the two buckets differ only by name.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, WhatsAppModule],
  controllers: [TemplatesController],
  providers: [
    TemplatesService,
    MediaStorage,
    {
      provide: MEDIA_BUCKET,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>("TEMPLATE_MEDIA_BUCKET") ?? "template-media",
    },
  ],
})
export class TemplatesModule {}
