import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { BusinessController } from "./business.controller";
import { BusinessService } from "./business.service";

@Module({
  // AuthModule supplies the guard, WorkspacesModule the tenant the row is owned
  // by. Nothing here talks to Meta — that is the WhatsApp module's job.
  imports: [AuthModule, WorkspacesModule],
  controllers: [BusinessController],
  providers: [BusinessService],
})
export class BusinessModule {}
