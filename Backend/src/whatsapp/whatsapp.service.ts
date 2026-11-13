import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import type { AuthClaims } from "../auth/auth.types";
import { UsersService } from "../auth/users.service";
import { SecretBox } from "../common/crypto/secret-box";
import { PrismaService } from "../prisma/prisma.service";
import type { ConnectWhatsAppDto } from "./dto/connect-whatsapp.dto";
import {
  MetaGraph,
  MetaRequestError,
  MetaTransportError,
  type BusinessDetails,
  type PhoneNumberDetails,
} from "./meta-graph";

export type CheckKey =
  | "accessToken"
  | "phoneNumberId"
  | "verifyToken"
  | "graphVersion"
  | "businessAccountId";

export type CheckState = "ok" | "failed" | "skipped";

export interface CheckResult {
  key: CheckKey;
  label: string;
  state: CheckState;
  /** Always written for a human: the toast and the panel show this verbatim. */
  detail: string;
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
  lastVerifiedAt: string | null;
  accessTokenHint: string;
  verifyTokenHint: string;
}

export interface ConnectResult {
  ok: boolean;
  summary: string;
  checks: CheckResult[];
  account: PublicAccount | null;
}

/** Form order, top to bottom. The UI renders the panel in exactly this order. */
const ORDER: CheckKey[] = [
  "accessToken",
  "phoneNumberId",
  "verifyToken",
  "graphVersion",
  "businessAccountId",
];

const LABELS: Record<CheckKey, string> = {
  accessToken: "Access token",
  phoneNumberId: "Phone number ID",
  verifyToken: "Verify token",
  graphVersion: "Graph version",
  businessAccountId: "Business account ID",
};

/**
 * Everything the API discloses about a stored row. The cipher columns stay
 * server-side; only a last-four hint leaves, which is enough for a human to
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
  lastVerifiedAt: true,
  accessTokenCipher: true,
  verifyTokenCipher: true,
} satisfies Prisma.WhatsAppAccountSelect;

type AccountRow = Prisma.WhatsAppAccountGetPayload<{ select: typeof ACCOUNT_SELECT }>;

/**
 * Which input a Meta rejection actually indicts. Separating these is the whole
 * point of the module: "invalid token" and "wrong id" need different fixes.
 */
type Blame = "accessToken" | "graphVersion" | "node" | "transport" | "unknown";

const ok = (detail: string): CheckResultState => ({ state: "ok", detail });
const failed = (detail: string): CheckResultState => ({ state: "failed", detail });
const skipped = (detail: string): CheckResultState => ({ state: "skipped", detail });

type CheckResultState = { state: CheckState; detail: string };

@Injectable()
export class WhatsAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly meta: MetaGraph,
    private readonly box: SecretBox,
  ) {}

  /**
   * Runs the five checks against Meta, and only writes when all five pass.
   *
   * A rejected credential must never reach the database: persisting it would
   * make the next webhook delivery fail for a reason no screen explains.
   */
  async connect(
    claims: AuthClaims,
    input: ConnectWhatsAppDto,
  ): Promise<ConnectResult> {
    const user = await this.users.syncFromClaims(claims);

    const version = input.graphVersion;
    const token = input.accessToken;
    const phoneId = input.phoneNumberId;
    const businessId = input.businessAccountId;

    const checks = new Map<CheckKey, CheckResultState>();
    for (const key of ORDER) {
      checks.set(key, skipped("Not reached."));
    }

    // The verify token is a shared secret we generate and Meta merely echoes
    // back during the webhook handshake — nothing at Meta can confirm it, so
    // this check is shape-only and is stated as such rather than faked.
    checks.set(
      "verifyToken",
      ok("Format accepted — Meta echoes this back when the webhook is verified."),
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

    const ordered: CheckResult[] = ORDER.map((key) => ({
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

    const values = {
      phoneNumberId: phoneId,
      businessAccountId: businessId,
      graphVersion: version,
      displayPhoneNumber: phone.display_phone_number ?? null,
      verifiedName: phone.verified_name ?? null,
      qualityRating: phone.quality_rating ?? null,
      businessName: business.name ?? null,
      status: "VERIFIED",
      lastVerifiedAt: new Date(),
      accessTokenCipher: this.box.seal(token),
      verifyTokenCipher: this.box.seal(input.verifyToken),
    } as const;

    const row = await this.prisma.whatsAppAccount.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...values },
      update: values,
      select: ACCOUNT_SELECT,
    });

    return {
      ok: true,
      summary: phone.display_phone_number
        ? `Connected ${phone.display_phone_number}. Meta verified the number and the business account.`
        : "Connected. Meta verified the number and the business account.",
      checks: ordered,
      account: this.toPublic(row),
    };
  }

  /** Read-only: an account cannot exist before its user row does. */
  async connection(
    claims: AuthClaims,
  ): Promise<{ account: PublicAccount | null }> {
    const row = await this.prisma.whatsAppAccount.findUnique({
      where: { userId: claims.id },
      select: ACCOUNT_SELECT,
    });

    return { account: row ? this.toPublic(row) : null };
  }

  async disconnect(claims: AuthClaims): Promise<{ removed: boolean }> {
    const { count } = await this.prisma.whatsAppAccount.deleteMany({
      where: { userId: claims.id },
    });

    return { removed: count > 0 };
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
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      accessTokenHint: this.hintOf(row.accessTokenCipher),
      verifyTokenHint: this.hintOf(row.verifyTokenCipher),
    };
  }

  /** A rotated key makes old ciphertext unreadable; the hint degrades, not throws. */
  private hintOf(cipher: string): string {
    try {
      return this.box.hint(this.box.open(cipher));
    } catch {
      return "••••";
    }
  }
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
