import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { InboxModule } from "../inbox/inbox.module";
import { TemplateMediaModule } from "../templates/template-media.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CampaignsController } from "./campaigns.controller";
import { Deliverer } from "./campaigns.delivery";
import { CampaignsEngine } from "./campaigns.engine";
import { CampaignsRunner } from "./campaigns.runner";
import { CampaignsService } from "./campaigns.service";

/**
 * Campaigns.
 *
 * `InboxModule` is imported for `InboxSender`: a campaign message and an inbox
 * message are the same row, so there is exactly one send path.
 * `TemplateMediaModule` is imported for the image a media header sends with.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, InboxModule, TemplateMediaModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignsEngine, Deliverer, CampaignsRunner],
})
export class CampaignsModule {}
