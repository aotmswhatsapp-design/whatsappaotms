import { createHmac, timingSafeEqual } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ReplyIntake } from "../agents/reply.intake";
import { SecretBox } from "../common/crypto/secret-box";
import { LeadIntake } from "../crm/lead.intake";
import { parseDelivery } from "../inbox/inbox.payload";
import { InboxStore } from "../inbox/inbox.store";
import { PrismaService } from "../prisma/prisma.service";
import {
  templateStatusEvents,
  wabaIds,
  type TemplateStatusEvent,
} from "../templates/template-status";

export type HandshakeOutcome =
  | { ok: true; challenge: string }
  /** 403 for all three: Meta only needs to know the token was not accepted. */
  | { ok: false; reason: "malformed" | "wrong-mode" | "token-mismatch" };

/** How long a trace row is worth keeping, and how often the sweep runs. */
const KEEP_MS = 7 * 86_400_000;
const SWEEP_MS = 3_600_000;

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
  /** When the trace was last swept; zero means the next call sweeps. */
  private sweptAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly box: SecretBox,
    private readonly config: ConfigService,
    private readonly store: InboxStore,
    private readonly intake: ReplyIntake,
    private readonly leads: LeadIntake,
  ) {}

  /**
   * Meta's console sends exactly one GET: mode=subscribe, our token, and a
   * challenge to echo verbatim. The challenge is proof we own the endpoint, so
   * it is returned only after the token matches a stored workspace.
   *
   * Each workspace gets its own `wa_...` token from the connect form and pastes
   * it into the Webhooks panel of the app that owns its number, so the match
   * also says which workspace just finished setting up.
   */
  async handshake(input: {
    mode: string | undefined;
    token: string | undefined;
    challenge: string | undefined;
    /** Meta's egress address, kept so one caller can be told from another. */
    ip?: string;
  }): Promise<HandshakeOutcome> {
    const seen = { mode: input.mode, token: input.token, ip: input.ip };

    if (input.mode !== "subscribe") {
      await this.trace({ ...seen, matchedAccountId: null });
      return { ok: false, reason: "wrong-mode" };
    }

    if (!input.token || !input.challenge) {
      await this.trace({ ...seen, matchedAccountId: null });
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
      // The row that makes this diagnosable: a call did arrive, with a token
      // that belongs to no workspace — which is what a stale Meta config looks
      // like from our side, and what the connection screen now reports.
      await this.trace({ ...seen, matchedAccountId: null });

      this.logger.warn(
        `Webhook handshake rejected: none of ${candidates.length} stored workspaces matches this token.`,
      );
      return { ok: false, reason: "token-mismatch" };
    }

    await this.prisma.whatsAppAccount.update({
      where: { id: matched },
      data: { webhookVerifiedAt: new Date() },
    });

    await this.trace({ ...seen, matchedAccountId: matched });

    this.logger.log("Webhook handshake accepted; workspace marked live.");

    return { ok: true, challenge: input.challenge };
  }

  /**
   * A delivery. The payload's `phone_number_id` says which workspace it belongs
   * to; signatures say whether the bytes were signed by Meta. Only a verified
   * delivery reaches the inbox store, which is the one place message content is
   * written — and the row it writes is scoped to the number that received it.
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
    const templateEvents = templateStatusEvents(payload);
    const wabas = wabaIds(payload);

    if (numbers.length === 0 && wabas.length === 0) {
      this.logger.log("Webhook delivery named no number and no account; ignored.");
      return;
    }

    // A message delivery names the number that received it. A template status
    // names only the business account, so both are matched — asking for a
    // phone_number_id is what made template statuses disappear entirely.
    const accounts = await this.prisma.whatsAppAccount.findMany({
      where: {
        OR: [
          { phoneNumberId: { in: numbers } },
          { businessAccountId: { in: wabas } },
        ],
      },
      select: {
        id: true,
        workspaceId: true,
        phoneNumberId: true,
        businessAccountId: true,
        appSecretCipher: true,
      },
    });

    if (accounts.length === 0) {
      this.logger.warn(
        `Webhook delivery for an unregistered account (${[...numbers, ...wabas].join(", ")}); ignored.`,
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

    // Parsed once: a single delivery can carry changes for several numbers, and
    // each account below takes only its own.
    const changes = parseDelivery(payload);

    for (const account of accounts) {
      const secret = account.appSecretCipher
        ? this.openOrNull(account.appSecretCipher)
        : null;

      const rowSigned =
        secret !== null &&
        signature !== undefined &&
        signatureMatches(raw, secret, signature);

      if (!rowSigned && !platformSigned) {
        // Only the app that owns the number can sign for it. A row stored
        // before app secrets were collected cannot verify at all, so it is
        // skipped with a message that names the fix. One-click rows carry no
        // per-row secret and rely on the platform signature above.
        this.logger.warn(
          secret
            ? "Webhook delivery signature matched neither the stored app secret nor the platform app secret; ignored."
            : "Webhook delivery could not be verified: no app secret stored for this number and no platform signature matched. Reconnect it.",
        );
        continue;
      }

      // An account can be named by a template event alone, in which case there
      // is no message to store.
      const receivedMessage = numbers.includes(account.phoneNumberId);
      const mine = templateEvents.filter(
        (event) => event.wabaId === account.businessAccountId,
      );

      if (!receivedMessage && mine.length === 0) continue;

      await this.prisma.whatsAppAccount.update({
        where: { id: account.id },
        data: { lastEventAt: new Date(), eventCount: { increment: 1 } },
      });

      if (receivedMessage) {
        const stored = await this.store.record(
          {
            id: account.id,
            workspaceId: account.workspaceId,
            phoneNumberId: account.phoneNumberId,
          },
          changes,
        );

        this.logger.log(`Signed delivery stored for ${account.phoneNumberId}.`);

        // A failed enqueue must never answer Meta with 500: a retry cannot fix
        // a database write that already failed, and the message is visible to a
        // person in the Inbox regardless.
        try {
          await this.intake.enqueue(
            { id: account.id, workspaceId: account.workspaceId },
            stored,
          );
        } catch (error) {
          this.logger.error(
            `Could not queue an AI reply for ${account.phoneNumberId}: ${
              error instanceof Error ? error.message : "unknown failure"
            }`,
          );
        }

        // A CRM failure must never answer Meta with 500 for a message that is
        // already stored: a retry cannot fix a classification.
        try {
          await this.leads.consider({ workspaceId: account.workspaceId }, stored);
        } catch (error) {
          this.logger.error(
            `Could not classify leads for ${account.phoneNumberId}: ${
              error instanceof Error ? error.message : "unknown failure"
            }`,
          );
        }
      }

      if (mine.length > 0) {
        await this.applyTemplateStatus(account.workspaceId, mine);
      }
    }
  }

  /**
   * Meta's review verdict, written over the cached row. A template that no sync
   * has seen yet has no row to update and is skipped: the next list read brings
   * it in, and inventing a row here would invent its category too.
   */
  private async applyTemplateStatus(
    workspaceId: string,
    events: TemplateStatusEvent[],
  ): Promise<void> {
    for (const event of events) {
      const { count } = await this.prisma.messageTemplate.updateMany({
        where: { workspaceId, metaId: event.templateId },
        data: {
          status: event.event,
          // A rejection carries the reason; anything else clears it.
          rejectedReason: event.event === "REJECTED" ? event.reason : null,
          lastSyncedAt: new Date(),
        },
      });

      if (count === 0) {
        this.logger.log(
          `Template ${event.templateId} (${event.name ?? "unnamed"}) is ${event.event}, but no cached row matches it yet.`,
        );
        continue;
      }

      this.logger.log(`Template ${event.templateId} is now ${event.event}.`);
    }
  }

  private openOrNull(cipher: string): string | null {
    try {
      return this.box.open(cipher);
    } catch {
      return null;
    }
  }

  /**
   * Writes one line of evidence per handshake attempt.
   *
   * Deliberately incapable of failing the request: a trace write that throws
   * would answer Meta with 500, teach it to retry, and hide the very call this
   * row exists to report. Only the last four characters of the presented token
   * are stored — enough to tell two tokens apart, useless as a credential.
   */
  private async trace(input: {
    mode: string | undefined;
    token: string | undefined;
    ip: string | undefined;
    matchedAccountId: string | null;
  }): Promise<void> {
    try {
      await this.prisma.webhookAttempt.create({
        data: {
          mode: input.mode?.slice(0, 32) ?? null,
          tokenHint: input.token ? lastFour(input.token) : null,
          matchedAccountId: input.matchedAccountId,
          ip: input.ip?.slice(0, 64) ?? null,
        },
      });

      await this.sweep();
    } catch (error) {
      this.logger.warn(
        `Could not record the handshake attempt: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  /** Old traces are evidence about a support conversation, not history. */
  private async sweep(): Promise<void> {
    const now = Date.now();

    if (now - this.sweptAt < SWEEP_MS) return;

    this.sweptAt = now;

    await this.prisma.webhookAttempt.deleteMany({
      where: { at: { lt: new Date(now - KEEP_MS) } },
    });
  }
}

/** Last four characters, which is all the trace is allowed to keep. */
function lastFour(token: string): string {
  return token.length <= 4 ? token : token.slice(-4);
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
