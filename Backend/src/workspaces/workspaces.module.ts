import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { WorkspaceRolesGuard } from "./workspace-roles.guard";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

/** Shared by every module that owns tenant data. */
@Module({
  imports: [AuthModule],
  controllers: [WorkspacesController],
  // The guard is exported so a controller in another module can name it in
  // `@UseGuards` and still have its dependency resolved from here.
  providers: [WorkspacesService, WorkspaceRolesGuard],
  exports: [WorkspacesService, WorkspaceRolesGuard],
})
export class WorkspacesModule {}
