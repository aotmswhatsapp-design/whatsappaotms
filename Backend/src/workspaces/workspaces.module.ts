import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WorkspacesService } from "./workspaces.service";

/** Shared by every module that owns tenant data. */
@Module({
  imports: [AuthModule],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
