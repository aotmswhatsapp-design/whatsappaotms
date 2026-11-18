import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  type RawBodyRequest,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request, Response } from "express";

import { WhatsAppWebhookService } from "./whatsapp-webhook.service";

/** Meta sends scalars; anything else means the caller is not Meta. */
function first(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

/**
 * Meta's side of the connection: no bearer token, no session, no CSRF — the
 * only credential is the verify token in the query string (GET) or the HMAC in
 * `X-Hub-Signature-256` (POST).
 *
 * Throttling is skipped because the bucket is per-IP and Meta's egress is a
 * handful of IPs serving every customer; a busy workspace would starve the
 * rest. The endpoints are cheap and write only counters.
 */
@Controller("v1/whatsapp/webhook")
@SkipThrottle()
export class WhatsAppWebhookController {
  constructor(private readonly webhook: WhatsAppWebhookService) {}

  /**
   * GET /api/v1/whatsapp/webhook — the handshake behind "Verify and save" in
   * Meta's console. Success is the challenge echoed as plain text, nothing else.
   */
  @Get()
  async verify(
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const outcome = await this.webhook.handshake({
      mode: first(query["hub.mode"]),
      token: first(query["hub.verify_token"]),
      challenge: first(query["hub.challenge"]),
    });

    if (!outcome.ok) {
      res.status(403).type("text/plain").send("Verification failed.");
      return;
    }

    res.status(200).type("text/plain").send(outcome.challenge);
  }

  /**
   * POST /api/v1/whatsapp/webhook — deliveries. Always 200: a non-2xx makes
   * Meta retry, and a delivery we could not verify will not verify later.
   */
  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.webhook.delivery(req.rawBody, signature);

    res.status(200).type("text/plain").send("EVENT_RECEIVED");
  }
}
