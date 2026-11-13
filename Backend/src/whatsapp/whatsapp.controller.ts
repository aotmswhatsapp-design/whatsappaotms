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
   * store them only if every check passes.
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

  /** GET /api/v1/whatsapp/connection — the stored connection, if any. */
  @Get("connection")
  connection(@CurrentUser() claims: AuthClaims) {
    return this.whatsapp.connection(claims);
  }

  /** DELETE /api/v1/whatsapp/connection — forget the stored credentials. */
  @Delete("connection")
  disconnect(@CurrentUser() claims: AuthClaims) {
    return this.whatsapp.disconnect(claims);
  }
}
