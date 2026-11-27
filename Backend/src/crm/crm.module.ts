import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CrmController } from "./crm.controller";
import { CrmService } from "./crm.service";
import { CrmSettingsService } from "./crm.settings";
import { LeadIntake } from "./lead.intake";
import { RoundRobin } from "./round.robin";
import { TasksService } from "./tasks.service";

/**
 * Leads, follow-up tasks and the routing settings.
 *
 * `AuthModule` supplies the guard and `WorkspacesModule` the tenant every route
 * resolves from the token. `LeadIntake` is exported because the WhatsApp
 * webhook — a different module — is the only caller: intake has no route of
 * its own, so it is the delivery that reads a message, not a cron.
 */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [CrmController],
  providers: [CrmService, CrmSettingsService, TasksService, LeadIntake, RoundRobin],
  exports: [CrmSettingsService, TasksService, LeadIntake],
})
export class CrmModule {}
