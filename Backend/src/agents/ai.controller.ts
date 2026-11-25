import {
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { AgentsService } from "./agents.service";

/**
 * AI state for one conversation.
 *
 * A path that names a conversation and a module that owns the agent: the URL
 * follows the resource, the code follows the dependency. The inbox never
 * imports this module, so there is no cycle to break.
 */
@Controller("v1/inbox/conversations/:id/ai")
@UseGuards(SupabaseAuthGuard)
export class AiController {
  constructor(private readonly agents: AgentsService) {}

  /** POST .../ai/pause — what a person does when they take the thread over. */
  @Post("pause")
  @HttpCode(200)
  pause(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.agents.pauseConversation(claims, id, "manual");
  }

  /** POST .../ai/resume — clears the pause; the agent answers again. */
  @Post("resume")
  @HttpCode(200)
  resume(
    @CurrentUser() claims: AuthClaims,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.agents.resumeConversation(claims, id);
  }
}
