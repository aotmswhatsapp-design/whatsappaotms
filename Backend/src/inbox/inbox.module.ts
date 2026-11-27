import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { SecretBox } from "../common/crypto/secret-box";
import { TemplateMediaModule } from "../templates/template-media.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { InboxController } from "./inbox.controller";
import { InboxGraph } from "./inbox.graph";
import { InboxSender } from "./inbox.sender";
import { InboxService } from "./inbox.service";
import { InboxStore } from "./inbox.store";
import { HistoryStore } from "./history.store";
import { MediaStorage } from "./media.storage";

/**
 * The inbox owns the tenant's customer content.
 *
 * `InboxStore` is exported because the WhatsApp webhook — a different module,
 * and the only unauthenticated writer — persists deliveries through it.
 * `InboxSender` is exported because campaigns send through it: a campaign
 * message and an inbox message are the same row, and there is one Meta path.
 *
 * `HistoryStore` is exported for the same reason as `InboxStore`: the WhatsApp
 * webhook is the only writer of imported history, and it lives elsewhere.
 *
 * `TemplateMediaModule` is imported only for `TemplatePhoto`: sending a
 * template whose header is an image needs the link to that image.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, TemplateMediaModule],
  controllers: [InboxController],
  providers: [
    InboxService,
    InboxSender,
    InboxStore,
    HistoryStore,
    InboxGraph,
    MediaStorage,
    SecretBox,
  ],
  exports: [InboxStore, HistoryStore, InboxSender, InboxGraph],
})
export class InboxModule {}
