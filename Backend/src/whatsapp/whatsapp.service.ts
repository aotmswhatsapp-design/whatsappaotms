import { randomBytes } from "node:crypto";

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { SecretBox } from "../common/crypto/secret-box";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { CoexistenceStarter } from "./coexistence.starter";
import { defaultAccount } from "./default-account";
import type { ConnectWhatsAppDto } from "./dto/connect-whatsapp.dto";
import type { EmbeddedSignupDto } from "./dto/embedded-signup.dto";
import type { CreateQrCodeDto, UpdateQrCodeDto } from "./dto/qr-code.dto";
import {
  MetaGraph,
  MetaRequestError,
  MetaShapeError,
  MetaTransportError,
  type BusinessDetails,
  type BusinessProfileDetails,
  type PhoneNumberDetails,
  type QrCodeDetails,
} from "./meta-graph";

export type CheckKey =
  | "accessToken"
  | "phoneNumberId"
  | "appId"
  | "appSecret"
  | "graphVersion"
  | "businessAccountId"
  | "verifyToken"
  | "subscription";

export type CheckState = "ok" | "failed" | "skipped";

export interface CheckResult {
  key: CheckKey;
  label: string;
  state: CheckState;
  /** Always written for a human: the toast and the panel show this verbatim. */
  detail: string;
}

/** Where the connection stands. `details` means nothing is stored yet. */
export type ConnectionStage = "details" | "webhook" | "live" | "error";

/** The four signals the sidebar dot reads. `pending` is the amber one. */
export type ConnectionState = "none" | "pending" | "live" | "error";

export interface WebhookFacts {
  /** What to paste into Meta, or null when the API has no public URL set. */
  callbackUrl: string | null;
  /** Set by Meta's GET handshake. */
  verifiedAt: string | null;
  lastEventAt: string | null;
  eventCount: number;
  /** Ours, and only useful inside Meta — so it is shown in full by design. */
  verifyToken: string | null;
  /**
   * The last GET this workspace's token answered, and the last that matched no
   * workspace at all. Together they separate "Meta never called" from "Meta
   * called with an older token" — two states the screen used to report as one
   * silence.
   */
  lastAttemptAt: string | null;
  lastUnmatchedAt: string | null;
  /** Last four characters of that stranger's token, to compare with ours. */
  lastUnmatchedHint: string | null;
}

/**
 * What the handshake trace can say about one connection, spread into the
 * public webhook facts so a screen reads one object rather than two shapes of
 * the same truth. Empty when the account has no trace to read.
 */
interface HandshakeTrace {
  lastAttemptAt: string | null;
  lastUnmatchedAt: string | null;
  lastUnmatchedHint: string | null;
}

const NO_TRACE: HandshakeTrace = {
  lastAttemptAt: null,
  lastUnmatchedAt: null,
  lastUnmatchedHint: null,
};

/**
 * What the connection screen knows about the 24-hour synchronisation.
 *
 * Computed from the stamps rather than stored as a status, because "requested
 * but not finished" is a real state that no single timestamp names.
 */
export interface CoexistenceSyncView {
  /** False means the card is absent: the number has no business-app data. */
  onBizApp: boolean;
  /** When Meta accepted the history request; null means it was never asked. */
  requestedAt: string | null;
  /** Meta's own id, which its support asks for. Not a webhook key. */
  requestId: string | null;
  doneAt: string | null;
  /** Meta's sentence: a refusal, a decline, a dead token. */
  error: string | null;
  /** True only while something is still unrequested and the window is open. */
  retryAllowed: boolean;
}

export interface PublicAccount {
  phoneNumberId: string;
  /** What the workspace calls this number; null means the screen shows digits. */
  label: string | null;
  /** The number readers that name none resolve to. At most one is true. */
  isDefault: boolean;
  businessAccountId: string;
  graphVersion: string;
  /**
   * The Meta app that issued the token. Shown in full: it is not a secret, and
   * it is the one value a customer has to correct when image uploads fail.
   */
  appId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  businessName: string | null;
  status: string;
  /** Which path created this row; the detail panel words itself by it. */
  source: string;
  /** True when the number is also in use in the WhatsApp Business app. */
  onBizApp: boolean;
  /** The 24-hour synchronisation, in the shape the screen reads. */
  sync: CoexistenceSyncView;
  /** When the business token lapses, ISO-formatted. Null means never or unknown. */
  tokenExpiresAt: string | null;
  lastVerifiedAt: string | null;
  lastCheckAt: string | null;
  failureReason: string | null;
  accessTokenHint: string;
  verifyTokenHint: string;
  appSecretHint: string | null;
  webhook: WebhookFacts;
}

export interface ConnectResult {
  ok: boolean;
  summary: string;
  checks: CheckResult[];
  account: PublicAccount | null;
}

/**
 * What the browser needs to launch Meta's dialog. `enabled` is false until the
 * operator's platform app exists in the API's environment; the screen then
 * leads with the manual path instead.
 */
export interface SignupConfigPayload {
  enabled: boolean;
  appId: string | null;
  configId: string | null;
  graphVersion: string;
}

export interface EmbeddedConnectResult {
  account: PublicAccount;
  summary: string;
}

/** The env values the one-click dialog cannot run without. */
interface PlatformApp {
  appId: string;
  appSecret: string;
  configId: string;
}

export interface ConnectionPayload {
  account: PublicAccount | null;
  stage: ConnectionStage;
  callbackUrl: string | null;
}

export interface StatusNumber {
  phoneNumberId: string;
  businessAccountId: string;
  /** Meta's pretty form, e.g. "+91 90000 12345". */
  display: string | null;
  businessName: string | null;
  verifiedName: string | null;
  quality: string | null;
  /** Meta's handshake — or the subscription one-click setup takes — landed. */
  receiving: boolean;
  /** When the business token lapses. Null means never-expiring or unknown. */
  tokenExpiresAt: string | null;
}

export interface StatusPayload {
  state: ConnectionState;
  /** Only meaningful for `error`: the sentence the dot's tooltip shows. */
  reason: string | null;
  /**
   * Filled whenever a number is stored, so the Overview can name the channel
   * without also asking for the whole connection. Null while there is none.
   */
  number: StatusNumber | null;
}

/**
 * What a customer sees when they open the chat. Three of these live on the
 * phone node and are therefore already stored; the rest exist only on the
 * profile edge and are read live, because there is no column for them.
 */
export interface BusinessProfileFacts {
  verifiedName: string | null;
  displayPhoneNumber: string | null;
  qualityRating: string | null;
  about: string | null;
  address: string | null;
  description: string | null;
  email: string | null;
  websites: string[];
  /** Meta's category, e.g. `RETAIL`. */
  vertical: string | null;
  pictureUrl: string | null;
}

export interface BusinessProfilePayload {
  /** False means no number is stored, so there is nothing to show. */
  connected: boolean;
  /** True only when the facts came from Meta on this request. */
  live: boolean;
  /** Why the live read is missing. The stored facts are still returned. */
  problem: string | null;
  profile: BusinessProfileFacts | null;
}

/** One QR code or short link, flattened to what a screen can render. */
export interface QrCodeFacts {
  code: string;
  prefilledMessage: string;
  /** `https://wa.me/message/{code}` — what goes on a poster or a bio. */
  shortLink: string;
  /** Meta's CDN rendering. Null on an update reply, which omits it. */
  imageUrl: string | null;
}

export interface QrCodeListPayload {
  /** False means no number is stored, so the page asks for a connection. */
  connected: boolean;
  /** Meta's ceiling per number, so the page can state a denominator. */
  limit: number;
  codes: QrCodeFacts[];
}

/**
 * Meta's documented ceiling per business phone number. Repeated here so the
 * page can say "3 of 2,000" instead of inventing its own limit.
 */
const QR_LIMIT = 2_000;

/** The inputs, in the order the form asks for them. */
const FORM_ORDER: CheckKey[] = [
  "accessToken",
  "phoneNumberId",
  "appId",
  "appSecret",
  "graphVersion",
  "businessAccountId",
];

/** The verify token is generated, so it is reported last rather than asked for. */
const CHECK_ORDER: CheckKey[] = [...FORM_ORDER, "verifyToken", "subscription"];

/**
 * Checks that report on the setup rather than on an input. None of them can
 * refuse a connection: the credentials themselves are already proven by Graph,
 * and a refusal here is a warning the customer acts on, not a failed save.
 */
const ADVISORY: ReadonlySet<CheckKey> = new Set<CheckKey>([
  "appId",
  "appSecret",
  "verifyToken",
  "subscription",
]);

const LABELS: Record<CheckKey, string> = {
  accessToken: "Access token",
  phoneNumberId: "Phone number ID",
  appId: "App ID",
  appSecret: "App secret",
  graphVersion: "Graph version",
  businessAccountId: "Whatsapp Account ID",
  verifyToken: "Verify token",
  subscription: "Webhook subscription",
};

const UNREADABLE_SECRET =
  "The stored credentials can no longer be decrypted — the encryption key changed. Reconnect.";

/** Why a one-click connection needs nothing pasted into Meta's console. */
const DIRECT_DELIVERY =
  "Meta delivers events here directly — there is nothing to paste into Meta's console.";

/**
 * Everything the API discloses about a stored row. The cipher columns stay
 * server-side; what leaves is a last-four hint, which is enough for a human to
 * recognise which token is installed and useless to anyone else.
 */
const ACCOUNT_SELECT = {
  /// Never disclosed; selected so the handshake trace can be looked up by it.
  id: true,
  label: true,
  isDefault: true,
  phoneNumberId: true,
  businessAccountId: true,
  graphVersion: true,
  appId: true,
  displayPhoneNumber: true,
  verifiedName: true,
  qualityRating: true,
  businessName: true,
  status: true,
  source: true,
  onBizApp: true,
  stateSyncAt: true,
  stateSyncRequestId: true,
  historySyncAt: true,
  historySyncRequestId: true,
  historySyncDoneAt: true,
  historySyncError: true,
  lastVerifiedAt: true,
  lastCheckAt: true,
  tokenExpiresAt: true,
  failureReason: true,
  webhookVerifiedAt: true,
  lastEventAt: true,
  eventCount: true,
  accessTokenCipher: true,
  verifyTokenCipher: true,
  appSecretCipher: true,
} satisfies Prisma.WhatsAppAccountSelect;

type AccountRow = Prisma.WhatsAppAccountGetPayload<{ select: typeof ACCOUNT_SELECT }>;

/** What a sync retry reads: the two request stamps and the window's anchor. */
const SYNC_SELECT = {
  id: true,
  phoneNumberId: true,
  graphVersion: true,
  accessTokenCipher: true,
  onBizApp: true,
  stateSyncAt: true,
  historySyncAt: true,
  historySyncRequestId: true,
  historySyncDoneAt: true,
  historySyncError: true,
  lastVerifiedAt: true,
} satisfies Prisma.WhatsAppAccountSelect;

/** The subset the status path needs; a page load should not read secrets. */
const STATUS_SELECT = {
  id: true,
  phoneNumberId: true,
  businessAccountId: true,
  graphVersion: true,
  displayPhoneNumber: true,
  verifiedName: true,
  qualityRating: true,
  businessName: true,
  status: true,
  failureReason: true,
  tokenExpiresAt: true,
  webhookVerifiedAt: true,
  lastEventAt: true,
  lastCheckAt: true,
  accessTokenCipher: true,
} satisfies Prisma.WhatsAppAccountSelect;

type StatusRow = Prisma.WhatsAppAccountGetPayload<{ select: typeof STATUS_SELECT }>;

/** Only what the profile card needs; the cipher column never leaves the API. */
const PROFILE_SELECT = {
  phoneNumberId: true,
  graphVersion: true,
  displayPhoneNumber: true,
  verifiedName: true,
  qualityRating: true,
  accessTokenCipher: true,
} satisfies Prisma.WhatsAppAccountSelect;

type ProfileRow = Prisma.WhatsAppAccountGetPayload<{ select: typeof PROFILE_SELECT }>;

/**
 * Which input a Meta rejection actually indicts. Separating these is the whole
 * point of the module: "invalid token" and "wrong id" need different fixes.
 */
type Blame =
  | "accessToken"
  | "expired"
  | "graphVersion"
  | "node"
  | "transport"
  | "unknown";

const ok = (detail: string): CheckResultState => ({ state: "ok", detail });
const failed = (detail: string): CheckResultState => ({ state: "failed", detail });
const skipped = (detail: string): CheckResultState => ({ state: "skipped", detail });

type CheckResultState = { state: CheckState; detail: string };

/** `wa_` + 32 hex: unmistakably ours, short enough to paste, impossible to guess. */
function generateVerifyToken(): string {
  return `wa_${randomBytes(16).toString("hex")}`;
}

@Injectable()
export class WhatsAppService {
  private readonly callbackUrl: string | null;
  private readonly statusTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly meta: MetaGraph,
    private readonly box: SecretBox,
    private readonly config: ConfigService,
    private readonly coexistence: CoexistenceStarter,
  ) {
    this.callbackUrl = config.get<string>("WHATSAPP_WEBHOOK_PUBLIC_URL") ?? null;
    this.statusTtlMs = config.get<number>("WHATSAPP_STATUS_TTL_MS") ?? 300_000;
  }

  /**
   * Runs the Graph checks against Meta, and only writes when they all pass.
   *
   * A rejected credential must never reach the database: persisting it would
   * make the next webhook delivery fail for a reason no screen explains.
   */
  async connect(
    claims: AuthClaims,
    input: ConnectWhatsAppDto,
  ): Promise<ConnectResult> {
    // Tenant first: the account row is owned by the workspace, and `userId` is
    // kept only to record who pasted the credentials.
    const { userId, workspaceId } = await this.workspaces.primaryFor(claims);

    const version = input.graphVersion;
    const token = input.accessToken;
    const phoneId = input.phoneNumberId;
    const businessId = input.businessAccountId;

    const checks = new Map<CheckKey, CheckResultState>();
    for (const key of CHECK_ORDER) {
      checks.set(key, skipped("Not reached."));
    }

    // Neither of these can be confirmed by Graph: the app secret is only proven
    // by a signature we have not received yet, and the verify token is ours.
    // They are reported as accepted-for-format rather than faked as verified.
    //
    // The app id is reported the same way, and for a related reason: the token
    // proves which app issued it only when an upload is attempted, so a wrong
    // id would pass every Graph read here and fail at the first image. Leaving
    // it blank is allowed — a text-only template never names the app.
    checks.set(
      "appId",
      input.appId
        ? ok("Accepted — image uploads are addressed by this app.")
        : ok("Not given. Text templates work; an image header needs it."),
    );
    checks.set(
      "appSecret",
      ok("Format accepted — the first signed delivery is the real proof."),
    );
    checks.set(
      "verifyToken",
      ok("Generated for this workspace. Copy it into Meta's webhook setup."),
    );

    let phone: PhoneNumberDetails | null = null;
    let business: BusinessDetails | null = null;
    let blocker: string | null = null;

    try {
      phone = await this.meta.getPhoneNumber(version, phoneId, token);
      checks.set("accessToken", ok("Accepted by Meta Graph."));
      checks.set("graphVersion", ok(`Graph ${version} answered.`));
      checks.set("phoneNumberId", ok(describePhone(phone)));
    } catch (error) {
      const verdict = blame(error, version, phoneId);

      switch (verdict.kind) {
        // Code 100 quoting the id means Meta routed the version and accepted
        // the token; only this one id is at fault, so keep going.
        case "node":
          checks.set("accessToken", ok("Accepted by Meta Graph."));
          checks.set("graphVersion", ok(`Graph ${version} answered.`));
          checks.set("phoneNumberId", failed(verdict.detail));
          break;

        case "accessToken":
          checks.set("accessToken", failed(verdict.detail));
          checks.set(
            "graphVersion",
            skipped("Not verified — the token was rejected first."),
          );
          checks.set(
            "phoneNumberId",
            skipped("Not verified — the token was rejected first."),
          );
          blocker = "The access token was rejected, so nothing else could be checked.";
          break;

        case "graphVersion":
          checks.set("graphVersion", failed(verdict.detail));
          checks.set(
            "accessToken",
            skipped("Not verified — Meta rejected the version first."),
          );
          checks.set(
            "phoneNumberId",
            skipped("Not usable until the version is right."),
          );
          blocker = verdict.detail;
          break;

        default:
          // Transport or an unclassifiable refusal: blame no input for it.
          checks.set("accessToken", skipped(verdict.detail));
          checks.set("graphVersion", skipped("Not verified."));
          checks.set("phoneNumberId", skipped("Not verified."));
          blocker = verdict.detail;
          break;
      }
    }

    if (blocker) {
      checks.set("businessAccountId", skipped(blocker));
      checks.set("subscription", skipped(blocker));
    } else {
      try {
        business = await this.meta.getBusinessAccount(version, businessId, token);
        checks.set("businessAccountId", ok(describeBusiness(business)));
      } catch (error) {
        checks.set("businessAccountId", failed(blame(error, version, businessId).detail));
      }

      // Meta delivers an event only to apps subscribed to the account, and a
      // hand-made connection subscribes nothing by itself — so this is what
      // stops a verified callback URL from receiving zero messages.
      try {
        await this.meta.subscribeApp({
          version,
          businessAccountId: businessId,
          token,
        });
        checks.set(
          "subscription",
          ok("This app is subscribed to the WhatsApp account, so deliveries will arrive."),
        );
      } catch (error) {
        checks.set(
          "subscription",
          failed(
            `Meta refused the subscription: ${blame(error, version, businessId).detail}`,
          ),
        );
      }
    }

    const ordered: CheckResult[] = CHECK_ORDER.map((key) => ({
      key,
      label: LABELS[key],
      ...(checks.get(key) ?? skipped("Not checked.")),
    }));

    // An advisory failure is shown but does not refuse the connection: the
    // credentials are proven, and a warning the customer can act on is worth
    // more than a save that keeps failing after Meta said yes.
    const allOk = ordered.every(
      (check) =>
        check.state === "ok" ||
        (check.state === "failed" && ADVISORY.has(check.key)),
    );

    if (!allOk || !phone || !business) {
      const firstFailure = ordered.find((check) => check.state === "failed");
      return {
        ok: false,
        summary:
          firstFailure?.detail ??
          "Meta could not verify these details. Nothing was saved.",
        checks: ordered,
        account: null,
      };
    }

    // One row per number, and a number answers for one workspace. `previous` is
    // this number's own row: reconnecting keeps the handshake it already
    // passed, since rotating our own token behind the customer's back would
    // silently turn a working webhook into a 403 until they visit Meta again.
    const previous = await this.heldNumber(phoneId, workspaceId);

    const verifyToken =
      (previous ? this.openOrNull(previous.verifyTokenCipher) : null) ??
      generateVerifyToken();

    const verifiedAt = new Date();

    const values = {
      phoneNumberId: phoneId,
      businessAccountId: businessId,
      graphVersion: version,
      // Leaving the field blank keeps the app id the row already had: an edit
      // that only rotates the token must not quietly break image uploads.
      appId: input.appId ?? previous?.appId ?? null,
      displayPhoneNumber: phone.display_phone_number ?? null,
      verifiedName: phone.verified_name ?? null,
      qualityRating: phone.quality_rating ?? null,
      businessName: business.name ?? null,
      status: "VERIFIED",
      lastVerifiedAt: verifiedAt,
      lastCheckAt: verifiedAt,
      failureReason: null,
      accessTokenCipher: this.box.seal(token),
      verifyTokenCipher: this.box.seal(verifyToken),
      appSecretCipher: this.box.seal(input.appSecret),
    } as const;

    // `webhookVerifiedAt` is deliberately absent: a created row starts with
    // none, and an updated one keeps the handshake it already passed.
    const isDefault = await this.seedsDefault(workspaceId, previous !== null);

    const row = await this.prisma.whatsAppAccount.upsert({
      where: { phoneNumberId: phoneId },
      create: { userId, workspaceId, isDefault, ...values },
      update: values,
      select: ACCOUNT_SELECT,
    });

    const number = phone.display_phone_number ?? `id ${phoneId}`;

    return {
      ok: true,
      summary: this.callbackUrl
        ? `Connected ${number}. Next: paste the callback URL and verify token into Meta.`
        : `Connected ${number}. The API's webhook URL is not configured yet, so Meta cannot reach it — set WHATSAPP_WEBHOOK_PUBLIC_URL.`,
      checks: ordered,
      account: this.toPublic(row, await this.traceFor(row.id)),
    };
  }

  /** Whether this deployment has a platform Meta app to run the dialog with. */
  signupConfig(): SignupConfigPayload {
    const app = this.platformApp();

    return {
      enabled: app !== null,
      appId: app?.appId ?? null,
      configId: app?.configId ?? null,
      graphVersion: this.graphVersion,
    };
  }

  /**
   * The one-click path. Meta's dialog already collected consent, so the work
   * left is making the result ours: trade the code for a token, prove the
   * number belongs to the account they authorised, subscribe our app, and
   * record when the token lapses.
   *
   * Every step is attempted before anything is written. A row saved halfway
   * would sit in "pending" forever and no screen would explain why.
   */
  async connectEmbedded(
    claims: AuthClaims,
    input: EmbeddedSignupDto,
  ): Promise<EmbeddedConnectResult> {
    const app = this.platformApp();

    if (!app) {
      throw new ServiceUnavailableException(
        "One-click setup is not enabled on this server yet. Use credentials instead.",
      );
    }

    const { userId, workspaceId } = await this.workspaces.primaryFor(claims);
    const version = this.graphVersion;
    const token = await this.exchangeCode(app, input.code);

    let owned: string[];

    try {
      owned = await this.meta.listBusinessPhoneNumberIds({
        version,
        businessAccountId: input.wabaId,
        token,
      });
    } catch (error) {
      throw new BadGatewayException(
        `Meta would not list the authorised account's numbers: ${explain(error)}`,
      );
    }

    const phoneNumberId = input.phoneNumberId ?? this.onlyOwned(owned);

    if (!owned.includes(phoneNumberId)) {
      throw new BadRequestException(
        "That phone number is not part of the WhatsApp Business account you authorised. Pick a number from inside the account and try again.",
      );
    }

    const phone = await this.readPhone(version, phoneNumberId, token);
    const businessName = await this.readBusinessName(version, input.wabaId, token);

    try {
      await this.meta.subscribeApp({
        version,
        businessAccountId: input.wabaId,
        token,
      });
    } catch (error) {
      throw new BadGatewayException(
        `Meta accepted the connection but would not send events to this app, so nothing would ever arrive: ${explain(error)}`,
      );
    }

    const { expiresAt } = await this.readTokenExpiry(app, version, token);
    const verifiedAt = new Date();

    const values = {
      phoneNumberId,
      businessAccountId: input.wabaId,
      graphVersion: version,
      appId: app.appId,
      displayPhoneNumber: phone.display_phone_number ?? null,
      verifiedName: phone.verified_name ?? null,
      qualityRating: phone.quality_rating ?? null,
      businessName,
      onBizApp: phone.is_on_biz_app === true,
      status: "VERIFIED",
      source: "EMBEDDED_SIGNUP",
      lastVerifiedAt: verifiedAt,
      lastCheckAt: verifiedAt,
      tokenExpiresAt: expiresAt === 0 ? null : new Date(expiresAt * 1000),
      failureReason: null,
      accessTokenCipher: this.box.seal(token),
      // Meta verifies the handshake with the platform token, so this per-row
      // secret is never pasted anywhere; the column is not nullable, so one is
      // minted and left unread rather than special-cased in every read path.
      verifyTokenCipher: this.box.seal(generateVerifyToken()),
      // Deliveries are signed by the platform app secret, not a customer one.
      appSecretCipher: null,
      // `subscribed_apps` is the proof the manual path gets from Meta's GET
      // handshake, so this connection is live the moment it succeeds.
      webhookVerifiedAt: verifiedAt,
    } as const;

    const previous = await this.heldNumber(phoneNumberId, workspaceId);

    const isDefault = await this.seedsDefault(workspaceId, previous !== null);

    const row = await this.prisma.whatsAppAccount.upsert({
      where: { phoneNumberId },
      create: { userId, workspaceId, isDefault, ...values },
      update: values,
      select: ACCOUNT_SELECT,
    });

    // The 24-hour clock starts at onboarding, so the two calls are made here
    // rather than when the screen is next opened. Awaited because a person is
    // waiting for the verdict, and these take about as long as the six Graph
    // reads above. `begin` itself decides whether they are legal.
    await this.coexistence.begin({
      id: row.id,
      phoneNumberId: row.phoneNumberId,
      graphVersion: row.graphVersion,
      accessTokenCipher: row.accessTokenCipher,
      onBizApp: row.onBizApp,
      stateSyncAt: row.stateSyncAt,
      historySyncAt: row.historySyncAt,
    });

    const number = phone.display_phone_number ?? `id ${phoneNumberId}`;

    return {
      account: this.toPublic(row),
      summary: phone.is_on_biz_app
        ? `Connected ${number}. It stays usable in the WhatsApp Business app, and what you send there now appears in this inbox too. ${DIRECT_DELIVERY}`
        : `Connected ${number}. ${DIRECT_DELIVERY}`,
    };
  }

  /**
   * The number for a dialog that named none.
   *
   * A coexistence finish reports only the business account — the number is
   * already in use in the WhatsApp Business app, so Meta does not return its
   * id. An account with one number therefore names it unambiguously; an
   * account with several does not, and guessing would write the wrong number
   * into the workspace and route every customer to it.
   */
  private onlyOwned(owned: string[]): string {
    if (owned.length === 1) return owned[0];

    throw new BadRequestException(
      owned.length === 0
        ? "The account you authorised has no phone number in it. Add the number in the WhatsApp Business app and connect again."
        : "The account you authorised has several numbers, and Meta did not say which one you connected. Connect the number again from its own settings in the WhatsApp Business app.",
    );
  }

  /** Read-only: an account cannot exist before its user row does. */
  async connection(claims: AuthClaims): Promise<ConnectionPayload> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const row = await defaultAccount(this.prisma, workspaceId, ACCOUNT_SELECT);

    if (!row) {
      return { account: null, stage: "details", callbackUrl: this.callbackUrl };
    }

    return {
      account: this.toPublic(row, await this.traceFor(row.id)),
      stage: stageOf(row),
      callbackUrl: this.callbackUrl,
    };
  }

  /**
   * Asks Meta again for whatever the synchronisation is still missing.
   *
   * The only honest retry. Inside the 24-hour window Meta can still say yes,
   * and a transport failure that stole the first attempt is the customer's
   * problem only if nothing lets them fix it.
   */
  async syncNow(claims: AuthClaims): Promise<{ sync: CoexistenceSyncView }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);
    const row = await defaultAccount(this.prisma, workspaceId, SYNC_SELECT);

    if (!row) {
      throw new BadRequestException("Connect a number first.");
    }

    if (!row.onBizApp) {
      throw new BadRequestException(
        "This number is not used in the WhatsApp Business app, so there is no history to sync.",
      );
    }

    // Something is still unrequested. Both accepted is a no-op answered with
    // the current state, not an error: a screen may repeat itself.
    const pending = !row.stateSyncAt || !row.historySyncAt;

    if (pending && !withinSyncWindow(row.lastVerifiedAt)) {
      throw new BadRequestException(
        "Meta only accepts this within 24 hours of connecting. The customer has to disconnect and connect again from the WhatsApp Business app.",
      );
    }

    if (pending) {
      await this.coexistence.begin(row);
    }

    const after = await defaultAccount(this.prisma, workspaceId, SYNC_SELECT);

    return { sync: syncViewOf(after ?? row) };
  }

  /**
   * The read-only half of the business profile: what Meta says customers see.
   *
   * Deliberately never throws for a bad read. The three phone facts are stored
   * and stay true even when Graph is unreachable, so a failure is reported as
   * `problem` beside them rather than replacing the whole card with an error.
   */
  async profileFor(claims: AuthClaims): Promise<BusinessProfilePayload> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const row = await defaultAccount(this.prisma, workspaceId, PROFILE_SELECT);

    if (!row) {
      return { connected: false, live: false, problem: null, profile: null };
    }

    const token = this.openOrNull(row.accessTokenCipher);

    if (!token) {
      return {
        connected: true,
        live: false,
        problem: UNREADABLE_SECRET,
        profile: profileFrom(row, null),
      };
    }

    try {
      const live = await this.meta.getBusinessProfile(
        row.graphVersion,
        row.phoneNumberId,
        token,
      );

      return {
        connected: true,
        live: true,
        problem: null,
        profile: profileFrom(row, live),
      };
    } catch (error) {
      return {
        connected: true,
        live: false,
        problem: blame(error, row.graphVersion, row.phoneNumberId).detail,
        profile: profileFrom(row, null),
      };
    }
  }

  /**
   * The number's QR codes and short links. An unconnected workspace gets an
   * empty list rather than an exception, because "connect a number" is a valid
   * state for this screen; a Graph failure is thrown, because a list that
   * silently reads empty would look like the codes were deleted.
   */
  async qrCodes(claims: AuthClaims): Promise<QrCodeListPayload> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const row = await defaultAccount(this.prisma, workspaceId, PROFILE_SELECT);

    if (!row) return { connected: false, limit: QR_LIMIT, codes: [] };

    const token = this.openOrNull(row.accessTokenCipher);

    if (!token) throw new BadRequestException(UNREADABLE_SECRET);

    try {
      const codes = await this.meta.listQrCodes(
        row.graphVersion,
        row.phoneNumberId,
        token,
      );

      return { connected: true, limit: QR_LIMIT, codes: codes.map(qrFrom) };
    } catch (error) {
      throw this.graphFailure(error, row.graphVersion, row.phoneNumberId);
    }
  }

  async createQrCode(
    claims: AuthClaims,
    input: CreateQrCodeDto,
  ): Promise<{ code: QrCodeFacts }> {
    const target = await this.graphTarget(claims);

    try {
      const created = await this.meta.createQrCode(
        target.version,
        target.phoneNumberId,
        target.token,
        { message: input.prefilledMessage, format: input.format ?? "SVG" },
      );

      return { code: qrFrom(created) };
    } catch (error) {
      throw this.graphFailure(error, target.version, target.phoneNumberId);
    }
  }

  /**
   * Changes the prefilled message only. Meta answers without `qr_image_url`, so
   * the returned facts carry a null image and the client keeps the one it has;
   * the printed code itself is unchanged by an edit.
   */
  async updateQrCode(
    claims: AuthClaims,
    code: string,
    input: UpdateQrCodeDto,
  ): Promise<{ code: QrCodeFacts }> {
    const target = await this.graphTarget(claims);

    try {
      const updated = await this.meta.updateQrCode(
        target.version,
        target.phoneNumberId,
        target.token,
        code,
        input.prefilledMessage,
      );

      return { code: qrFrom(updated) };
    } catch (error) {
      throw this.graphFailure(error, target.version, target.phoneNumberId);
    }
  }

  /** Retires a code for good: anyone scanning it afterwards sees "expired". */
  async removeQrCode(
    claims: AuthClaims,
    code: string,
  ): Promise<{ removed: boolean }> {
    const target = await this.graphTarget(claims);

    try {
      await this.meta.deleteQrCode(
        target.version,
        target.phoneNumberId,
        target.token,
        code,
      );

      return { removed: true };
    } catch (error) {
      throw this.graphFailure(error, target.version, target.phoneNumberId);
    }
  }

  /**
   * Trades Meta's one-shot signup code for a token. The code expires within
   * minutes and works once, so the error tells the customer to retry the
   * button rather than to go hunting for a setting.
   */
  private async exchangeCode(app: PlatformApp, code: string): Promise<string> {
    try {
      return await this.meta.exchangeCode({
        version: this.graphVersion,
        clientId: app.appId,
        clientSecret: app.appSecret,
        code,
      });
    } catch (error) {
      throw new BadGatewayException(
        `Meta did not accept the signup code: ${explain(error)} Codes are single-use, so try the button again.`,
      );
    }
  }

  private async readPhone(
    version: string,
    phoneNumberId: string,
    token: string,
  ): Promise<PhoneNumberDetails> {
    try {
      return await this.meta.getPhoneNumber(version, phoneNumberId, token);
    } catch (error) {
      throw new BadGatewayException(
        `Meta accepted the account but would not describe number ${phoneNumberId}: ${explain(error)}`,
      );
    }
  }

  private async readBusinessName(
    version: string,
    businessAccountId: string,
    token: string,
  ): Promise<string | null> {
    try {
      const business = await this.meta.getBusinessAccount(
        version,
        businessAccountId,
        token,
      );

      return business.name ?? null;
    } catch {
      // A missing display name is cosmetic; the connection is already proven.
      return null;
    }
  }

  /**
   * Mandatory, by product decision: a stored token whose lifetime is unknown is
   * the silent two-month death this feature exists to prevent, so an
   * unreadable expiry refuses the connection instead of storing null.
   */
  private async readTokenExpiry(
    app: PlatformApp,
    version: string,
    token: string,
  ): Promise<{ expiresAt: number }> {
    let debug: { isValid: boolean; expiresAt: number | null };

    try {
      debug = await this.meta.debugToken({
        version,
        appId: app.appId,
        appSecret: app.appSecret,
        token,
      });
    } catch (error) {
      throw new BadGatewayException(
        `Meta accepted the connection but would not confirm when its token expires, so it was not saved: ${explain(error)}`,
      );
    }

    if (!debug.isValid || debug.expiresAt === null) {
      throw new BadGatewayException(
        "Meta accepted the connection but reported its token as invalid or of unknown lifetime, so it was not saved. Try the button again.",
      );
    }

    return { expiresAt: debug.expiresAt };
  }

  /**
   * The three values the dialog cannot run without. The app secret is in the
   * list because the code exchange, `debug_token` and delivery signatures all
   * need it.
   */
  private platformApp(): PlatformApp | null {
    const appId = this.config.get<string>("META_APP_ID");
    const appSecret = this.config.get<string>("META_APP_SECRET");
    const configId = this.config.get<string>("META_ES_CONFIG_ID");

    if (!appId || !appSecret || !configId) return null;

    return { appId, appSecret, configId };
  }

  private get graphVersion(): string {
    return this.config.get<string>("META_GRAPH_VERSION") ?? "v27.0";
  }

  /**
   * The three values a Graph call needs. Throwing here — rather than returning
   * a verdict — is right for the write paths: a mutation that could not be
   * attempted must not answer 200.
   */
  private async graphTarget(
    claims: AuthClaims,
  ): Promise<{ version: string; phoneNumberId: string; token: string }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const row = await defaultAccount(this.prisma, workspaceId, PROFILE_SELECT);

    if (!row) {
      throw new BadRequestException(
        "Connect a WhatsApp number before creating QR codes or short links.",
      );
    }

    const token = this.openOrNull(row.accessTokenCipher);

    if (!token) throw new BadRequestException(UNREADABLE_SECRET);

    return {
      version: row.graphVersion,
      phoneNumberId: row.phoneNumberId,
      token,
    };
  }

  /**
   * A Graph refusal becomes 502 with Meta's own sentence: the credentials are
   * valid enough to have been routed, so the caller is not blamed for them.
   */
  private graphFailure(
    error: unknown,
    version: string,
    node: string,
  ): BadGatewayException {
    return new BadGatewayException(blame(error, version, node).detail);
  }

  /**
   * Removes the number the workspace answers from — not every number it owns.
   *
   * With one number those are the same act, so nothing changes. With several,
   * deleting all of them would be a data loss no screen warned about: the rest
   * stay connected and the oldest is promoted in the removed row's place.
   */
  async disconnect(claims: AuthClaims): Promise<{ removed: boolean }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const target = await defaultAccount(this.prisma, workspaceId, { id: true });

    if (!target) return { removed: false };

    await this.prisma.whatsAppAccount.deleteMany({
      where: { id: target.id, workspaceId },
    });

    await this.promoteDefault(workspaceId);

    return { removed: true };
  }

  /**
   * Fills the gap `disconnect` leaves. A workspace whose default is gone has
   * none until here, and every reader that names no number would already fall
   * back to the oldest row — this writes that choice down, so the stored state
   * and the resolved state cannot disagree.
   */
  private async promoteDefault(workspaceId: string): Promise<void> {
    const current = await this.prisma.whatsAppAccount.findFirst({
      where: { workspaceId, isDefault: true },
      select: { id: true },
    });

    if (current) return;

    const next = await this.prisma.whatsAppAccount.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (!next) return;

    await this.prisma.whatsAppAccount.update({
      where: { id: next.id },
      data: { isDefault: true },
    });
  }

  /**
   * Replaces our half of the handshake. The old token stops matching at once,
   * and the connection drops back to "pending" until Meta echoes the new one.
   */
  async rotateVerifyToken(
    claims: AuthClaims,
  ): Promise<{ rotated: boolean; verifyToken: string | null }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const row = await defaultAccount(this.prisma, workspaceId, {
      id: true,
      source: true,
    });

    if (!row) return { rotated: false, verifyToken: null };

    // An Embedded Signup row has no token in Meta's console to rotate, and
    // minting one here would only throw the connection back to "pending".
    if (row.source === "EMBEDDED_SIGNUP") {
      return { rotated: false, verifyToken: null };
    }

    const verifyToken = generateVerifyToken();

    await this.prisma.whatsAppAccount.update({
      where: { id: row.id },
      data: {
        verifyTokenCipher: this.box.seal(verifyToken),
        webhookVerifiedAt: null,
      },
    });

    return { rotated: true, verifyToken };
  }

  /**
   * The sidebar's answer, cheap by default: inside the TTL this reads the
   * stored verdict and never touches the network.
   */
  async status(
    claims: AuthClaims,
    options: { force?: boolean } = {},
  ): Promise<StatusPayload> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const row = await defaultAccount(this.prisma, workspaceId, STATUS_SELECT);

    if (!row) return { state: "none", reason: null, number: null };

    const checkedRecently =
      row.lastCheckAt !== null &&
      Date.now() - row.lastCheckAt.getTime() < this.statusTtlMs;

    if (!options.force && checkedRecently) {
      return deriveStatus(row);
    }

    return this.recheck(row);
  }

  /** `POST /check` — the same re-check, without waiting for the TTL. */
  async recheckNow(claims: AuthClaims): Promise<StatusPayload> {
    return this.status(claims, { force: true });
  }

  /**
   * Asks Graph whether the stored token still works. A transport failure is
   * not evidence against the credentials, so it leaves the verdict alone and
   * only re-arms the TTL.
   */
  private async recheck(row: StatusRow): Promise<StatusPayload> {
    const token = this.openOrNull(row.accessTokenCipher);

    if (!token) {
      await this.recordCheck(row.id, {
        status: "FAILED",
        failureReason: UNREADABLE_SECRET,
      });

      return { state: "error", reason: UNREADABLE_SECRET, number: numberFrom(row) };
    }

    try {
      const phone = await this.meta.getPhoneNumber(
        row.graphVersion,
        row.phoneNumberId,
        token,
      );

      await this.recordCheck(row.id, {
        status: "VERIFIED",
        failureReason: null,
        lastVerifiedAt: new Date(),
        displayPhoneNumber: phone.display_phone_number ?? null,
        verifiedName: phone.verified_name ?? null,
        qualityRating: phone.quality_rating ?? null,
      });

      return deriveStatus({ ...row, status: "VERIFIED", failureReason: null });
    } catch (error) {
      const verdict = blame(error, row.graphVersion, row.phoneNumberId);

      if (verdict.kind === "transport") {
        await this.recordCheck(row.id, {});
        return deriveStatus(row);
      }

      await this.recordCheck(row.id, {
        status: "FAILED",
        failureReason: verdict.detail,
      });

      return { state: "error", reason: verdict.detail, number: numberFrom(row) };
    }
  }

  private recordCheck(
    id: string,
    data: Prisma.WhatsAppAccountUpdateInput,
  ): Promise<unknown> {
    return this.prisma.whatsAppAccount.update({
      where: { id },
      data: { ...data, lastCheckAt: new Date() },
    });
  }

  /**
   * The row for a number, whoever holds it — refused when that is a different
   * workspace.
   *
   * A number used to be unique per workspace, so two workspaces could register
   * the same one. The webhook looks a delivery up by the number and stores it
   * per matching row, which meant both inboxes received the message and both
   * agents answered it. `phoneNumberId` is unique now, and this is the check
   * that turns the index into a sentence instead of a P2002.
   */
  private async heldNumber(
    phoneNumberId: string,
    workspaceId: string,
  ): Promise<{ appId: string | null; verifyTokenCipher: string } | null> {
    const row = await this.prisma.whatsAppAccount.findUnique({
      where: { phoneNumberId },
      select: { workspaceId: true, appId: true, verifyTokenCipher: true },
    });

    if (row && row.workspaceId !== workspaceId) {
      throw new ConflictException({
        code: "NUMBER_TAKEN",
        message:
          "This WhatsApp number is already connected to another workspace. Disconnect it there before connecting it here.",
      });
    }

    return row;
  }

  /**
   * Whether a row about to be written should carry the default flag.
   *
   * Only the first number a workspace connects becomes the default. Connecting
   * a second one must not move what campaigns, template submissions and reports
   * already answer from — switching the default is a deliberate act, not a side
   * effect of connecting.
   */
  private async seedsDefault(
    workspaceId: string,
    numberExists: boolean,
  ): Promise<boolean> {
    if (numberExists) return false;

    return (await this.prisma.whatsAppAccount.count({ where: { workspaceId } })) === 0;
  }

  private toPublic(row: AccountRow, trace: HandshakeTrace = NO_TRACE): PublicAccount {
    return {
      phoneNumberId: row.phoneNumberId,
      label: row.label,
      isDefault: row.isDefault,
      businessAccountId: row.businessAccountId,
      graphVersion: row.graphVersion,
      appId: row.appId,
      displayPhoneNumber: row.displayPhoneNumber,
      verifiedName: row.verifiedName,
      qualityRating: row.qualityRating,
      businessName: row.businessName,
      status: row.status,
      source: row.source,
      onBizApp: row.onBizApp,
      sync: syncViewOf(row),
      tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      lastCheckAt: row.lastCheckAt?.toISOString() ?? null,
      failureReason: row.failureReason,
      accessTokenHint: this.hintOf(row.accessTokenCipher),
      verifyTokenHint: this.hintOf(row.verifyTokenCipher),
      appSecretHint: row.appSecretCipher ? this.hintOf(row.appSecretCipher) : null,
      webhook: {
        callbackUrl: this.callbackUrl,
        verifiedAt: row.webhookVerifiedAt?.toISOString() ?? null,
        lastEventAt: row.lastEventAt?.toISOString() ?? null,
        eventCount: row.eventCount,
        // A signup row is verified once for the whole app in Meta's panel, so
        // there is no per-workspace token to hand back.
        verifyToken:
          row.source === "EMBEDDED_SIGNUP"
            ? null
            : this.openOrNull(row.verifyTokenCipher),
        ...trace,
      },
    };
  }

  /**
   * What the handshake trace says about this connection.
   *
   * Two rows answer the question the screen cannot answer from a null stamp:
   * has anyone called at all, and did the last caller present our token? A
   * stranger's row is global by nature — a rejected token belongs to no
   * workspace — but it is the only evidence that Meta *is* reaching us.
   */
  private async traceFor(accountId: string): Promise<HandshakeTrace> {
    const [mine, stranger] = await Promise.all([
      this.prisma.webhookAttempt.findFirst({
        where: { matchedAccountId: accountId },
        orderBy: { at: "desc" },
        select: { at: true },
      }),
      this.prisma.webhookAttempt.findFirst({
        where: { matchedAccountId: null },
        orderBy: { at: "desc" },
        select: { at: true, tokenHint: true },
      }),
    ]);

    return {
      lastAttemptAt: mine?.at.toISOString() ?? null,
      lastUnmatchedAt: stranger?.at.toISOString() ?? null,
      lastUnmatchedHint: stranger?.tokenHint ?? null,
    };
  }

  /** A rotated key makes old ciphertext unreadable; the hint degrades, not throws. */
  private hintOf(cipher: string): string {
    const plain = this.openOrNull(cipher);
    return plain ? this.box.hint(plain) : "••••";
  }

  private openOrNull(cipher: string): string | null {
    try {
      return this.box.open(cipher);
    } catch {
      return null;
    }
  }

}

/**
 * Proof that the pipe is open. The GET handshake is the tidy path, but a signed
 * delivery is stronger evidence still: it proves the callback URL, the app
 * secret and the subscription in one go. Treating only the handshake as proof
 * left a channel that was already receiving events reading "waiting" forever.
 */
function isReceiving(row: {
  webhookVerifiedAt: Date | null;
  lastEventAt: Date | null;
}): boolean {
  return row.webhookVerifiedAt !== null || row.lastEventAt !== null;
}

function stageOf(row: {
  status: string;
  webhookVerifiedAt: Date | null;
  lastEventAt: Date | null;
}): ConnectionStage {
  if (row.status === "FAILED") return "error";
  return isReceiving(row) ? "live" : "webhook";
}

const SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;

function withinSyncWindow(at: Date | null): boolean {
  return at !== null && Date.now() - at.getTime() <= SYNC_WINDOW_MS;
}

function syncViewOf(row: {
  onBizApp: boolean;
  stateSyncAt: Date | null;
  historySyncAt: Date | null;
  historySyncRequestId: string | null;
  historySyncDoneAt: Date | null;
  historySyncError: string | null;
  lastVerifiedAt: Date | null;
}): CoexistenceSyncView {
  return {
    onBizApp: row.onBizApp,
    requestedAt: row.historySyncAt?.toISOString() ?? null,
    requestId: row.historySyncRequestId,
    doneAt: row.historySyncDoneAt?.toISOString() ?? null,
    error: row.historySyncError,
    // Once both kinds were accepted there is nothing left to ask for; once it
    // is done, asking again needs the customer to offboard and onboard.
    retryAllowed:
      row.onBizApp &&
      row.historySyncDoneAt === null &&
      (!row.stateSyncAt || !row.historySyncAt) &&
      withinSyncWindow(row.lastVerifiedAt),
  };
}

function deriveStatus(row: StatusRow): StatusPayload {
  const number = numberFrom(row);

  if (row.status === "FAILED") {
    return {
      state: "error",
      reason: row.failureReason ?? "Meta no longer accepts these credentials.",
      number,
    };
  }

  return isReceiving(row)
    ? { state: "live", reason: null, number }
    : { state: "pending", reason: null, number };
}

/** The few facts the Overview repeats about the channel. */
function numberFrom(row: StatusRow): StatusNumber {
  return {
    phoneNumberId: row.phoneNumberId,
    businessAccountId: row.businessAccountId,
    display: row.displayPhoneNumber,
    businessName: row.businessName,
    verifiedName: row.verifiedName,
    quality: row.qualityRating,
    receiving: isReceiving(row),
    tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
  };
}

function describePhone(phone: PhoneNumberDetails): string {
  const number = phone.display_phone_number ?? `id ${phone.id}`;
  const name = phone.verified_name ? ` · ${phone.verified_name}` : "";
  const quality = phone.quality_rating ? ` · quality ${phone.quality_rating}` : "";

  return `${number}${name}${quality}`;
}

function describeBusiness(business: BusinessDetails): string {
  const name = business.name ?? `id ${business.id}`;
  const status = business.verification_status
    ? ` · ${business.verification_status}`
    : "";

  return `${name}${status}`;
}

/**
 * Stored phone facts plus whatever the live read returned. Blank strings become
 * null so the card can decide between "nothing set" and "nothing fetched".
 */
function profileFrom(
  row: ProfileRow,
  live: BusinessProfileDetails | null,
): BusinessProfileFacts {
  return {
    verifiedName: row.verifiedName,
    displayPhoneNumber: row.displayPhoneNumber,
    qualityRating: row.qualityRating,
    about: live?.about?.trim() || null,
    address: live?.address?.trim() || null,
    description: live?.description?.trim() || null,
    email: live?.email?.trim() || null,
    websites: (live?.websites ?? []).map((site) => site.trim()).filter(Boolean),
    vertical: live?.vertical?.trim() || null,
    pictureUrl: live?.profile_picture_url?.trim() || null,
  };
}

/**
 * Meta's short link is `https://wa.me/message/{code}`. It is rebuilt from the
 * code when the reply omits it, because the code is the one part every reply
 * carries and the pattern is fixed rather than customer-specific.
 */
function qrFrom(details: QrCodeDetails): QrCodeFacts {
  const code = details.code.trim();

  return {
    code,
    prefilledMessage: details.prefilled_message?.trim() ?? "",
    shortLink: details.deep_link_url?.trim() || `https://wa.me/message/${code}`,
    imageUrl: details.qr_image_url?.trim() || null,
  };
}

/** One sentence a customer can act on, without Meta's error envelope. */
function explain(error: unknown): string {
  if (error instanceof MetaShapeError || error instanceof MetaTransportError) {
    return error.message;
  }

  if (error instanceof MetaRequestError) {
    return error.explanation;
  }

  return error instanceof Error ? error.message : "Unexpected failure.";
}

/**
 * Meta tells you which thing it refused through its error code plus the id it
 * quotes in the message. Observed live: no token ⇒ 400/104, rejected token ⇒
 * 401/400/190, unknown object or version ⇒ 400/100 with the offender quoted.
 */
function blame(
  error: unknown,
  version: string,
  node: string,
): { kind: Blame; detail: string } {
  if (error instanceof MetaTransportError) {
    return { kind: "transport", detail: error.message };
  }

  if (error instanceof MetaRequestError) {
    const message = error.body.message.trim() || `HTTP ${error.status}`;

    // 190 is "invalid token"; 463 is specifically "session expired". A revoked
    // token and an expired one need different fixes, so they must not share a
    // sentence.
    if (error.code === 190 && error.body.error_subcode === 463) {
      return {
        kind: "expired",
        detail:
          "Meta says this connection's token has expired. Reconnect it with the one-click button on this screen.",
      };
    }

    if (error.code === 190) {
      return {
        kind: "accessToken",
        detail: `Meta rejected the access token: ${message}`,
      };
    }

    if (error.code === 104) {
      return {
        kind: "accessToken",
        detail: "Meta received no usable access token for this request.",
      };
    }

    if (error.code === 100) {
      // The quoted id decides it: the version is the culprit only when Meta
      // quotes the version itself.
      if (message.includes(version)) {
        return {
          kind: "graphVersion",
          detail: `Meta does not serve API version ${version}.`,
        };
      }

      if (message.includes(node)) {
        return {
          kind: "node",
          detail: "Meta found no object with this id, or the token cannot access it.",
        };
      }
    }

    return {
      kind: error.status === 401 || error.status === 403 ? "accessToken" : "unknown",
      detail: `Meta refused the request: ${message}`,
    };
  }

  return {
    kind: "unknown",
    detail: error instanceof Error ? error.message : "Unexpected failure.",
  };
}
