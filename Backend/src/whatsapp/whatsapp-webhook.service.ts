import { createHmac, timingSafeEqual } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { SecretBox } from "../common/crypto/secret-box";
import { PrismaService } from "../prisma/prisma.service";

export type HandshakeOutcome =
  | { ok: true; challenge: string }
  /** 403 for all three: Meta only needs to know the token was not accepted. */
  | { ok: false; reason: "malformed" | "wrong-mode" | "token-mismatch" };

/**
 * The public half of the module: what Meta calls, unauthenticated.
 *
 * Both entry points are written to be boring on purpose. Nothing here throws —
 * a 500 teaches Meta to retry, and a retry of a payload we cannot verify will
 * never succeed. Every refusal is logged and answered, so the loop stops.
 */
@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly box: SecretBox,
    private readonly config: ConfigService,
  ) {}

  /**
   * Meta's console sends exactly one GET: mode=subscribe, our token, and a
   * challenge to echo verbatim. The challenge is proof we own the endpoint, so
   * it is returned only after the token matches.
   *
   * Two tokens are accepted. A platform app is verified once for the whole
   * deployment — there is no single workspace to mark, because each Embedded
   * Signup row went live when our app was subscribed to it. A customer's own
   * app still verifies with the per-workspace token the manual form shows.
   */
  async handshake(input: {
    mode: string | undefined;
    token: string | undefined;
    challenge: string | undefined;
  }): Promise<HandshakeOutcome> {
    if (input.mode !== "subscribe") {
      return { ok: false, reason: "wrong-mode" };
    }

    if (!input.token || !input.challenge) {
      return { ok: false, reason: "malformed" };
    }

    const platformToken = this.config.get<string>("WHATSAPP_WEBHOOK_VERIFY_TOKEN");

    if (platformToken && equals(platformToken, input.token)) {
      this.logger.log("Webhook handshake accepted by the platform token.");
      return { ok: true, challenge: input.challenge };
    }

    const candidates = await this.prisma.whatsAppAccount.findMany({
      select: { id: true, verifyTokenCipher: true },
    });

    // Every row is compared, with no early exit, so the response time does not
    // say which workspace in the table matched.
    let matched: string | null = null;

    for (const row of candidates) {
      const stored = this.openOrNull(row.verifyTokenCipher);
      if (stored && equals(stored, input.token) && matched === null) {
        matched = row.id;
      }
    }

    if (!matched) {
      this.logger.warn(
        `Webhook handshake rejected: no of ${candidates.length} stored workspaces matches this token.`,
      );
      return { ok: false, reason: "token-mismatch" };
    }

    await this.prisma.whatsAppAccount.update({
      where: { id: matched },
      data: { webhookVerifiedAt: new Date() },
    });

    this.logger.log("Webhook handshake accepted; workspace marked live.");

    return { ok: true, challenge: input.challenge };
  }

  /**
   * A delivery. The payload's `phone_number_id` says which workspace it belongs
   * to; signatures say whether the bytes were signed by Meta. Only the
   * timestamp and a counter are kept — no message content is stored.
   */
  async delivery(
    raw: Buffer | undefined,
    signature: string | undefined,
  ): Promise<void> {
    if (!raw || raw.length === 0) {
      this.logger.warn("Webhook delivery had no body; ignored.");
      return;
    }

    const payload = parseJson(raw);
    if (payload === null) {
      this.logger.warn("Webhook delivery was not JSON; ignored.");
      return;
    }

    const numbers = phoneNumberIds(payload);

    if (numbers.length === 0) {
      this.logger.log("Webhook delivery carried no phone_number_id; ignored.");
      return;
    }

    const accounts = await this.prisma.whatsAppAccount.findMany({
      where: { phoneNumberId: { in: numbers } },
      select: { id: true, appSecretCipher: true },
    });

    if (accounts.length === 0) {
      this.logger.warn(
        `Webhook delivery for an unregistered number (${numbers.join(", ")}); ignored.`,
      );
      return;
    }

    // A platform-app delivery is signed with our app secret and a customer-app
    // one with theirs; either proves Meta sent the bytes. Computed once because
    // a single delivery can carry numbers from several workspaces.
    const platformSecret = this.config.get<string>("META_APP_SECRET") ?? null;

    const platformSigned =
      signature !== undefined &&
      platformSecret !== null &&
      signatureMatches(raw, platformSecret, signature);

    for (const account of accounts) {
      const secret = account.appSecretCipher
        ? this.openOrNull(account.appSecretCipher)
        : null;

      const rowSigned =
        secret !== null &&
        signature !== undefined &&
        signatureMatches(raw, secret, signature);

      if (!rowSigned && !platformSigned) {
        // A row stored before app secrets were collected cannot verify on its
        // own, so such deliveries are counted only when our platform app signed.
        this.logger.warn(
          secret
            ? "Webhook delivery signature matched neither the stored app secret nor the platform app's; ignored."
            : "Webhook delivery could not be verified: no app secret stored and the signature is not the platform app's.",
        );
        continue;
      }

      await this.prisma.whatsAppAccount.update({
        where: { id: account.id },
        data: { lastEventAt: new Date(), eventCount: { increment: 1 } },
      });

      this.logger.log(`Signed delivery recorded for ${numbers.join(", ")}.`);
    }
  }

  private openOrNull(cipher: string): string | null {
    try {
      return this.box.open(cipher);
    } catch {
      return null;
    }
  }
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

/** `sha256=<hex>` over the bytes we received, compared in constant time. */
function signatureMatches(raw: Buffer, secret: string, header: string): boolean {
  const [scheme, digest] = header.split("=");

  if (scheme !== "sha256" || !digest) return false;

  const expected = createHmac("sha256", secret).update(raw).digest();
  const provided = Buffer.from(digest, "hex");

  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

/**
 * `entry[].changes[].value.metadata.phone_number_id`, deduplicated. Meta batches
 * several changes into one delivery, and they can belong to different numbers.
 */
function phoneNumberIds(payload: unknown): string[] {
  const found = new Set<string>();

  const entries = (payload as { entry?: unknown } | null)?.entry;
  if (!Array.isArray(entries)) return [];

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown } | null)?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = (change as { value?: unknown } | null)?.value;
      const id = (value as { metadata?: { phone_number_id?: unknown } } | null)
        ?.metadata?.phone_number_id;

      if (typeof id === "string" && id.length > 0) found.add(id);
    }
  }

  return [...found];
}
