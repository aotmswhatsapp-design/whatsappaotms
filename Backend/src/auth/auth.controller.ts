import { Controller, Get, UseGuards } from "@nestjs/common";

import type { AuthClaims } from "./auth.types";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { SupabaseAuthGuard } from "./supabase-auth.guard";

@Controller("v1/auth")
@UseGuards(SupabaseAuthGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** GET /api/v1/auth/me — profile + workspace memberships. */
  @Get("me")
  me(@CurrentUser() claims: AuthClaims) {
    return this.auth.profile(claims);
  }
}
