import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { ConnectWhatsAppDto } from "./dto/connect-whatsapp.dto";
import { WhatsAppService } from "./whatsapp.service";

@Controller("v1/whatsapp")
@UseGuards(SupabaseAuthGuard)
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  /**
   * POST /api/v1/whatsapp/connect — verify the five details against Meta and
   * store them only if every check passes. The verify token is generated here.
   *
   * 200 with `ok: false` rather than a 4xx: the verdict *is* the payload, and
   * the client needs the per-check breakdown to say which field to fix.
   * A tighter ceiling than the global one because each call reaches Meta.
   */
  @Post("connect")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  connect(
    @CurrentUser() claims: AuthClaims,
    @Body() dto: ConnectWhatsAppDto,
  ) {
    return this.whatsapp.connect(claims, dto);
  }

  /**
   * GET /api/v1/whatsapp/connection — the stored connection, the stage it
   * belongs to, and the two values Meta's console asks for.
   */
  @Get("connection")
  connection(@CurrentUser() claims: AuthClaims) {
    return this.whatsapp.connection(claims);
  }

  /**
   * GET /api/v1/whatsapp/profile — the business profile customers see, read
   * from Meta for the stored number. Throttled like `connect` because every
   * call is a Graph request rather than a database read.
   */
  @Get("profile")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  profile(@CurrentUser() claims: AuthClaims) {
    return this.whatsapp.profileFor(claims);
  }

  /** POST /api/v1/whatsapp/verify-token/rotate — new token, handshake reset. */
  @Post("verify-token/rotate")
  @HttpCode(200)
  rotateVerifyToken(@CurrentUser() claims: AuthClaims) {
    return this.whatsapp.rotateVerifyToken(claims);
  }

  /**
   * GET /api/v1/whatsapp/status — what the sidebar dot reads. Cached for
   * WHATSAPP_STATUS_TTL_MS, so a page load is not automatically a Meta call.
   */
  @Get("status")
  status(@CurrentUser() claims: AuthClaims) {
    return this.whatsapp.status(claims);
  }

  /** POST /api/v1/whatsapp/check — the same re-check, forced past the cache. */
  @Post("check")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  check(@CurrentUser() claims: AuthClaims) {
    return this.whatsapp.recheckNow(claims);
  }

  /** DELETE /api/v1/whatsapp/connection — forget the stored credentials. */
  @Delete("connection")
  disconnect(@CurrentUser() claims: AuthClaims) {
    return this.whatsapp.disconnect(claims);
  }
}
