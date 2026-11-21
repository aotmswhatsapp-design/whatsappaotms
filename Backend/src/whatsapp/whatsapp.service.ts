import { randomBytes } from "node:crypto";

import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { SecretBox } from "../common/crypto/secret-box";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { ConnectWhatsAppDto } from "./dto/connect-whatsapp.dto";
import type { CreateQrCodeDto, UpdateQrCodeDto } from "./dto/qr-code.dto";
import {
  MetaGraph,
  MetaRequestError,
  MetaTransportError,
  type BusinessDetails,
  type BusinessProfileDetails,
  type PhoneNumberDetails,
  type QrCodeDetails,
} from "./meta-graph";

export type CheckKey =
  | "accessToken"
  | "phoneNumberId"
  | "appSecret"
  | "graphVersion"
  | "businessAccountId"
  | "verifyToken";

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
}

export interface PublicAccount {
  phoneNumberId: string;
  businessAccountId: string;
  graphVersion: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  businessName: string | null;
  status: string;
  /** Which path created this row; the detail panel words itself by it. */
  source: string;
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

/** The five inputs, in the order the form asks for them. */
const FORM_ORDER: CheckKey[] = [
  "accessToken",
  "phoneNumberId",
  "appSecret",
  "graphVersion",
  "businessAccountId",
];

/** The verify token is generated, so it is reported last rather than asked for. */
const CHECK_ORDER: CheckKey[] = [...FORM_ORDER, "verifyToken"];

const LABELS: Record<CheckKey, string> = {
  accessToken: "Access token",
  phoneNumberId: "Phone number ID",
  appSecret: "App secret",
  graphVersion: "Graph version",
  businessAccountId: "Whatsapp Account ID",
  verifyToken: "Verify token",
};

const UNREADABLE_SECRET =
  "The stored credentials can no longer be decrypted — the encryption key changed. Reconnect.";

/**
 * Everything the API discloses about a stored row. The cipher columns stay
 * server-side; what leaves is a last-four hint, which is enough for a human to
 * recognise which token is installed and useless to anyone else.
 */
const ACCOUNT_SELECT = {
  phoneNumberId: true,
  businessAccountId: true,
  graphVersion: true,
  displayPhoneNumber: true,
  verifiedName: true,
  qualityRating: true,
  businessName: true,
  status: true,
  source: true,
  lastVerifiedAt: true,
  lastCheckAt: true,
  failureReason: true,
  webhookVerifiedAt: true,
  lastEventAt: true,
  eventCount: true,
  accessTokenCipher: true,
  verifyTokenCipher: true,
  appSecretCipher: true,
} satisfies Prisma.WhatsAppAccountSelect;

type AccountRow = Prisma.WhatsAppAccountGetPayload<{ select: typeof ACCOUNT_SELECT }>;

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
  webhookVerifiedAt: true,
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
type Blame = "accessToken" | "graphVersion" | "node" | "transport" | "unknown";

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
    config: ConfigService,
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
    } else {
      try {
        business = await this.meta.getBusinessAccount(version, businessId, token);
        checks.set("businessAccountId", ok(describeBusiness(business)));
      } catch (error) {
        checks.set("businessAccountId", failed(blame(error, version, businessId).detail));
      }
    }

    const ordered: CheckResult[] = CHECK_ORDER.map((key) => ({
      key,
      label: LABELS[key],
      ...(checks.get(key) ?? skipped("Not checked.")),
    }));

    const allOk = ordered.every((check) => check.state === "ok");

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

    // Reconnecting to the same number keeps the handshake it already passed:
    // rotating our own token behind the customer's back would silently turn a
    // working webhook into a 403 until they visit Meta again.
    const previous = await this.prisma.whatsAppAccount.findUnique({
      where: { workspaceId },
      select: { phoneNumberId: true, verifyTokenCipher: true },
    });

    const verifyToken =
      (previous ? this.openOrNull(previous.verifyTokenCipher) : null) ??
      generateVerifyToken();

    const verifiedAt = new Date();

    const values = {
      phoneNumberId: phoneId,
      businessAccountId: businessId,
      graphVersion: version,
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
      // A different number means a different delivery target, so the handshake
      // proven for the old one no longer counts.
      ...(previous && previous.phoneNumberId !== phoneId
        ? { webhookVerifiedAt: null }
        : {}),
    } as const;

    const row = await this.prisma.whatsAppAccount.upsert({
      where: { workspaceId },
      create: { userId, workspaceId, ...values },
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
      account: this.toPublic(row),
    };
  }

  /** Read-only: an account cannot exist before its user row does. */
  async connection(claims: AuthClaims): Promise<ConnectionPayload> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const row = await this.prisma.whatsAppAccount.findUnique({
      where: { workspaceId },
      select: ACCOUNT_SELECT,
    });

    if (!row) {
      return { account: null, stage: "details", callbackUrl: this.callbackUrl };
    }

    return {
      account: this.toPublic(row),
      stage: stageOf(row),
      callbackUrl: this.callbackUrl,
    };
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

    const row = await this.prisma.whatsAppAccount.findUnique({
      where: { workspaceId },
      select: PROFILE_SELECT,
    });

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

    const row = await this.prisma.whatsAppAccount.findUnique({
      where: { workspaceId },
      select: PROFILE_SELECT,
    });

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
   * The three values a Graph call needs. Throwing here — rather than returning
   * a verdict — is right for the write paths: a mutation that could not be
   * attempted must not answer 200.
   */
  private async graphTarget(
    claims: AuthClaims,
  ): Promise<{ version: string; phoneNumberId: string; token: string }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const row = await this.prisma.whatsAppAccount.findUnique({
      where: { workspaceId },
      select: PROFILE_SELECT,
    });

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

  async disconnect(claims: AuthClaims): Promise<{ removed: boolean }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const { count } = await this.prisma.whatsAppAccount.deleteMany({
      where: { workspaceId },
    });

    return { removed: count > 0 };
  }

  /**
   * Replaces our half of the handshake. The old token stops matching at once,
   * and the connection drops back to "pending" until Meta echoes the new one.
   */
  async rotateVerifyToken(
    claims: AuthClaims,
  ): Promise<{ rotated: boolean; verifyToken: string | null }> {
    const { workspaceId } = await this.workspaces.primaryFor(claims);

    const row = await this.prisma.whatsAppAccount.findUnique({
      where: { workspaceId },
      select: { id: true },
    });

    if (!row) return { rotated: false, verifyToken: null };

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

    const row = await this.prisma.whatsAppAccount.findUnique({
      where: { workspaceId },
      select: STATUS_SELECT,
    });

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

  private toPublic(row: AccountRow): PublicAccount {
    return {
      phoneNumberId: row.phoneNumberId,
      businessAccountId: row.businessAccountId,
      graphVersion: row.graphVersion,
      displayPhoneNumber: row.displayPhoneNumber,
      verifiedName: row.verifiedName,
      qualityRating: row.qualityRating,
      businessName: row.businessName,
      status: row.status,
      source: row.source,
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
        verifyToken: this.openOrNull(row.verifyTokenCipher),
      },
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

function stageOf(row: { status: string; webhookVerifiedAt: Date | null }): ConnectionStage {
  if (row.status === "FAILED") return "error";
  return row.webhookVerifiedAt ? "live" : "webhook";
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

  return row.webhookVerifiedAt
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
    receiving: row.webhookVerifiedAt !== null,
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
