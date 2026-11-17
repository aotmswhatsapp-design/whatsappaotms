import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import type { AuthClaims } from "./auth.types";
import { AuthService } from "./auth.service";
import { ConfirmationsService } from "./confirmations.service";
import { CurrentUser } from "./current-user.decorator";
import { ResendConfirmationDto } from "./dto/resend-confirmation.dto";
import { SupabaseAuthGuard } from "./supabase-auth.guard";

/**
 * The guard sits on `me()` rather than the class: confirm/resend has to be
 * reachable by a browser that has no session yet, which is the whole point of
 * a confirmation email.
 */
@Controller("v1/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly confirmations: ConfirmationsService,
  ) {}

  /** GET /api/v1/auth/me — profile + workspace memberships. */
  @Get("me")
  @UseGuards(SupabaseAuthGuard)
  me(@CurrentUser() claims: AuthClaims) {
    return this.auth.profile(claims);
  }

  /**
   * POST /api/v1/auth/confirm/resend — re-sends the sign-up code.
   *
   * Five per minute per IP: this endpoint makes the project's mail quota the
   * blast radius of an abuse attempt, not the throttler. 202 on every accepted
   * call, so the response cannot be used to probe which addresses exist.
   */
  @Post("confirm/resend")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resendConfirmation(@Body() dto: ResendConfirmationDto) {
    return this.confirmations.resend(dto.email);
  }
}
