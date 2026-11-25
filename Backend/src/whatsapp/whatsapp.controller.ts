import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import type { AuthClaims } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { Roles } from "../workspaces/workspace-roles.decorator";
import { WorkspaceRolesGuard } from "../workspaces/workspace-roles.guard";
import { ConnectWhatsAppDto } from "./dto/connect-whatsapp.dto";
import { EmbeddedSignupDto } from "./dto/embedded-signup.dto";
import { CreateQrCodeDto, UpdateQrCodeDto } from "./dto/qr-code.dto";
import { WhatsAppService } from "./whatsapp.service";

@Controller("v1/whatsapp")
@UseGuards(SupabaseAuthGuard, WorkspaceRolesGuard)
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
  @Roles("OWNER")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  connect(
    @CurrentUser() claims: AuthClaims,
    @Body() dto: ConnectWhatsAppDto,
  ) {
    return this.whatsapp.connect(claims, dto);
  }

  /**
   * GET /api/v1/whatsapp/signup-config — whether this server can run Meta's
   * one-click dialog, plus the two ids the browser SDK needs. No Graph call.
   */
  @Get("signup-config")
  signupConfig() {
    return this.whatsapp.signupConfig();
  }

  /**
   * POST /api/v1/whatsapp/embedded-signup — the browser forwards the code and
   * the two ids Meta's dialog returned; the server does the rest.
   *
   * Unlike `connect`, a refusal is a 4xx/5xx with one readable sentence: there
   * is no per-field breakdown to render because the customer typed nothing.
   */
  @Post("embedded-signup")
  @Roles("OWNER")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  embeddedSignup(
    @CurrentUser() claims: AuthClaims,
    @Body() dto: EmbeddedSignupDto,
  ) {
    return this.whatsapp.connectEmbedded(claims, dto);
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
  @Roles("OWNER")
  @HttpCode(200)
  rotateVerifyToken(@CurrentUser() claims: AuthClaims) {
    return this.whatsapp.rotateVerifyToken(claims);
  }

  /**
   * QR codes and short links, all four operations on Meta's `message_qrdls`
   * edge. Throttled like `connect`: every one of these is a Graph request, and
   * a scan or a poster is the only way to learn anything from them afterwards —
   * Meta reports no scan statistics.
   */
  @Get("qr-codes")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  qrCodes(@CurrentUser() claims: AuthClaims) {
    return this.whatsapp.qrCodes(claims);
  }

  @Post("qr-codes")
  @Roles("OWNER")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createQrCode(
    @CurrentUser() claims: AuthClaims,
    @Body() dto: CreateQrCodeDto,
  ) {
    return this.whatsapp.createQrCode(claims, dto);
  }

  /** PATCH, not PUT: the prefilled message is the only field being replaced. */
  @Patch("qr-codes/:code")
  @Roles("OWNER")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  updateQrCode(
    @CurrentUser() claims: AuthClaims,
    @Param("code") code: string,
    @Body() dto: UpdateQrCodeDto,
  ) {
    return this.whatsapp.updateQrCode(claims, code, dto);
  }

  @Delete("qr-codes/:code")
  @Roles("OWNER")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  deleteQrCode(@CurrentUser() claims: AuthClaims, @Param("code") code: string) {
    return this.whatsapp.removeQrCode(claims, code);
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
  @Roles("OWNER")
  disconnect(@CurrentUser() claims: AuthClaims) {
    return this.whatsapp.disconnect(claims);
  }
}
