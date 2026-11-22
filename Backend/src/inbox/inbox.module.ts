import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { SecretBox } from "../common/crypto/secret-box";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { InboxController } from "./inbox.controller";
import { InboxGraph } from "./inbox.graph";
import { InboxSender } from "./inbox.sender";
import { InboxService } from "./inbox.service";
import { InboxStore } from "./inbox.store";
import { MediaStorage } from "./media.storage";

/**
 * The inbox owns the tenant's customer content.
 *
 * `InboxStore` is exported because the WhatsApp webhook — a different module,
 * and the only unauthenticated writer — persists deliveries through it.
 * `InboxSender` is exported because campaigns send through it: a campaign
 * message and an inbox message are the same row, and there is one Meta path.
 */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [InboxController],
  providers: [
    InboxService,
    InboxSender,
    InboxStore,
    InboxGraph,
    MediaStorage,
    SecretBox,
  ],
  exports: [InboxStore, InboxSender, InboxGraph],
})
export class InboxModule {}
