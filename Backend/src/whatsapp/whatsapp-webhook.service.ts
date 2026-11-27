import { createHmac, timingSafeEqual } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";

import { ReplyIntake } from "../agents/reply.intake";
import { SecretBox } from "../common/crypto/secret-box";
import { LeadIntake } from "../crm/lead.intake";
import { HistoryStore } from "../inbox/history.store";
import { parseDelivery } from "../inbox/inbox.payload";
import { InboxStore, type StoreAccount } from "../inbox/inbox.store";
import { PrismaService } from "../prisma/prisma.service";
import {
  templateStatusEvents,
  wabaIds,
  type TemplateStatusEvent,
} from "../templates/template-status";
import {
  accountEvents,
  disconnectNote,
  isDisconnect,
  type AccountEvent,
} from "./account-events";
import {
  historyDeclined,
  historyProgress,
  historyThreads,
  mediaAssets,
  stateSyncContacts,
  type DeclinedSync,
  type HistoryThread,
  type MediaAsset,
  type SyncProgress,
  type SyncedContact,
} from "./coexistence";
import { CoexistenceStarter } from "./coexistence.starter";

export type HandshakeOutcome =
  | { ok: true; challenge: string }
  /** 403 for all three: Meta only needs to know the token was not accepted. */
  | { ok: false; reason: "malformed" | "wrong-mode" | "token-mismatch" };

/** How long a trace row is worth keeping, and how often the sweep runs. */
const KEEP_MS = 7 * 86_400_000;
const SWEEP_MS = 3_600_000;

/** What `CoexistenceStarter.begin` reads, and nothing else. */
const ACCOUNT_SYNC_SELECT = {
  id: true,
  phoneNumberId: true,
  graphVersion: true,
  accessTokenCipher: true,
  onBizApp: true,
  stateSyncAt: true,
  historySyncAt: true,
} satisfies Prisma.WhatsAppAccountSelect;

/** What one coexistence delivery can carry, already parsed. */
type SyncDelivery = {
  threads: HistoryThread[];
  contacts: SyncedContact[];
  assets: MediaAsset[];
  progress: SyncProgress[];
  declines: DeclinedSync[];
};

/**
 * Whether any coexistence payload in this delivery names the number.
 *
 * A history chunk carries no message, so the message-shaped guard below would
 * skip the account and the import would never run.
 */
function namesNumber(parsed: SyncDelivery, phoneNumberId: string): boolean {
  return (
    parsed.threads.some((row) => row.phoneNumberId === phoneNumberId) ||
    parsed.contacts.some((row) => row.phoneNumberId === phoneNumberId) ||
    parsed.assets.some((row) => row.phoneNumberId === phoneNumberId) ||
    parsed.progress.some((row) => row.phoneNumberId === phoneNumberId) ||
    parsed.declines.some((row) => row.phoneNumberId === phoneNumberId)
  );
}

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
    private readonly history: HistoryStore,
    private readonly coexistence: CoexistenceStarter,
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
    // An `account_update` names the customer's account in `value.waba_info`,
    // because `entry[].id` is the partner's id there. Both are collected or a
    // disconnection would never match a row.
    const accountChanges = accountEvents(payload);
    // Coexistence: parsed once per delivery, beside the template statuses, and
    // each account below takes only the rows that name its number.
    const threads = historyThreads(payload);
    const syncContacts = stateSyncContacts(payload);
    const assets = mediaAssets(payload);
    const progress = historyProgress(payload);
    const declines = historyDeclined(payload);
    const wabas = [
      ...new Set([
        ...wabaIds(payload),
        ...accountChanges.map((event) => event.wabaId),
      ]),
    ];

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
        displayPhoneNumber: true,
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

      // A history change carries `metadata.phone_number_id` too, so naming the
      // number is not proof there is a message. Only a parsed change with
      // something in it may run the inbox path.
      const receivedMessage = changes.some(
        (change) =>
          change.phoneNumberId === account.phoneNumberId &&
          (change.contacts.length > 0 ||
            change.messages.length > 0 ||
            change.echoes.length > 0 ||
            change.statuses.length > 0),
      );
      const mine = templateEvents.filter(
        (event) => event.wabaId === account.businessAccountId,
      );
      const updates = accountChanges.filter(
        (event) => event.wabaId === account.businessAccountId,
      );

      const sync: SyncDelivery = {
        threads,
        contacts: syncContacts,
        assets,
        progress,
        declines,
      };
      const hasSync = namesNumber(sync, account.phoneNumberId);

      // A coexistence delivery is a delivery: it moves the stamps the sidebar
      // reads, and it must reach the sync path even though it carries no
      // message for the inbox.
      if (
        !receivedMessage &&
        !hasSync &&
        mine.length === 0 &&
        updates.length === 0
      ) {
        continue;
      }

      await this.prisma.whatsAppAccount.update({
        where: { id: account.id },
        data: { lastEventAt: new Date(), eventCount: { increment: 1 } },
      });

      if (updates.length > 0) {
        await this.applyAccountEvents(account.id, updates);
      }

      // The same literal `store.record` is given below.
      const target: StoreAccount = {
        id: account.id,
        workspaceId: account.workspaceId,
        phoneNumberId: account.phoneNumberId,
        displayPhoneNumber: account.displayPhoneNumber,
      };

      await this.applySync(target, sync);

      if (receivedMessage) {
        const stored = await this.store.record(target, changes);

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
   * Meta telling us the connection itself changed state.
   *
   * A disconnection is written over the row rather than deleting it: the
   * credentials stay for the owner to inspect, and `status: FAILED` is the
   * state the connection screen already renders with a reason — so a number
   * that silently stopped working finally says why. Nothing else in the app
   * re-verifies a row without an owner action, which is why a reconnect is
   * honoured too: otherwise a number would stay red forever after the customer
   * fixed it on their side.
   */
  private async applyAccountEvents(
    accountId: string,
    events: AccountEvent[],
  ): Promise<void> {
    for (const event of events) {
      if (isDisconnect(event)) {
        await this.prisma.whatsAppAccount.update({
          where: { id: accountId },
          data: {
            status: "FAILED",
            failureReason: disconnectNote(event),
            lastCheckAt: new Date(),
          },
        });

        this.logger.warn(
          `Account ${event.wabaId} reported ${event.event} (${event.reason ?? "no reason"}); marked unusable.`,
        );
        continue;
      }

      if (event.event === "ACCOUNT_RECONNECTED") {
        const row = await this.prisma.whatsAppAccount.update({
          where: { id: accountId },
          data: {
            status: "VERIFIED",
            failureReason: null,
            // Meta re-grants the synchronisation after an offboard/onboard, so
            // stale stamps would suppress a legal sync. `lastVerifiedAt` moves
            // with them because it is what the 24-hour retry window is measured
            // from — leaving it would refuse a sync Meta has just allowed.
            lastVerifiedAt: new Date(),
            lastCheckAt: new Date(),
            stateSyncAt: null,
            stateSyncRequestId: null,
            historySyncAt: null,
            historySyncRequestId: null,
            historySyncDoneAt: null,
            historySyncError: null,
          },
          select: ACCOUNT_SYNC_SELECT,
        });

        // Not awaited: Meta is waiting on this delivery, and a slow Graph call
        // here becomes a retried webhook. The stamps make a duplicate run safe.
        void this.coexistence.begin(row).catch((error: unknown) => {
          this.logger.warn(
            `Could not request the sync for ${row.phoneNumberId}: ${
              error instanceof Error ? error.message : "unknown failure"
            }`,
          );
        });

        this.logger.log(`Account ${event.wabaId} is connected again.`);
      }
    }
  }

  /**
   * The coexistence half of a delivery: history chunks, the address book and
   * media assets.
   *
   * Each step is isolated. A chunk that fails to write must not stop the live
   * message path beneath it, and must not answer Meta with a 500 for a delivery
   * it would only retry into the same failure.
   */
  private async applySync(
    account: StoreAccount,
    parsed: SyncDelivery,
  ): Promise<void> {
    const mine = (rows: { phoneNumberId: string }[]) =>
      rows.some((row) => row.phoneNumberId === account.phoneNumberId);

    // Nothing in this delivery names this number: skip without a round trip.
    if (!namesNumber(parsed, account.phoneNumberId)) {
      return;
    }

    const decline = parsed.declines.find(
      (row) => row.phoneNumberId === account.phoneNumberId,
    );
    const progress = parsed.progress.find(
      (row) => row.phoneNumberId === account.phoneNumberId,
    );

    if (decline) {
      await this.quietly("the declined history", () =>
        this.history.noteDeclined(account, decline.sentence),
      );
    } else if (progress?.progress === 100) {
      await this.quietly("the finished history", () =>
        this.history.noteComplete(account),
      );
    }

    if (mine(parsed.threads)) {
      await this.quietly("a history chunk", () =>
        this.history.import(account, parsed.threads),
      );
    }

    if (mine(parsed.contacts)) {
      await this.quietly("the address book", () =>
        this.history.absorbContacts(account, parsed.contacts),
      );
    }

    for (const asset of parsed.assets) {
      await this.quietly("a media asset", () =>
        this.history.attachMedia(account, asset),
      );
    }
  }

  private async quietly(
    label: string,
    run: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error(
        `Could not write ${label} for a coexistence delivery: ${
          error instanceof Error ? error.message : "unknown failure"
        }`,
      );
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
 *
 * The root-level read exists for one payload and one only: Meta's history
 * decline arrives as a bare object with no `entry` wrapper, and without this
 * the refusal names no number, is ignored as unregistered, and the screen waits
 * forever for a sync that was refused.
 */
function phoneNumberIds(payload: unknown): string[] {
  const found = new Set<string>();
  const root = payload as
    | { entry?: unknown; metadata?: { phone_number_id?: unknown } }
    | null;

  const bare = root?.metadata?.phone_number_id;
  if (typeof bare === "string" && bare.length > 0) found.add(bare);

  const entries = root?.entry;
  if (!Array.isArray(entries)) return [...found];

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
