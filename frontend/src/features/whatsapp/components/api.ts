import { request } from "@/lib/api/http";

export { ApiError } from "@/lib/api/http";

export type CheckState = "ok" | "failed" | "skipped";

export interface CheckResult {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
}

/** What to paste into Meta, and the proof that Meta used it. */
export interface WebhookFacts {
  callbackUrl: string | null;
  verifiedAt: string | null;
  lastEventAt: string | null;
  eventCount: number;
  verifyToken: string | null;
  /** The last call whose verify token was this workspace's. */
  lastAttemptAt: string | null;
  /** The last call that matched no workspace — Meta still holding an old token. */
  lastUnmatchedAt: string | null;
  /** Its last four characters, so the two tokens can be compared on screen. */
  lastUnmatchedHint: string | null;
}

/** What the screen knows about the 24-hour synchronisation. */
export interface CoexistenceSync {
  /** False means the card is absent: the number has no business-app data. */
  onBizApp: boolean;
  /** When Meta accepted the history request; null means it was never asked. */
  requestedAt: string | null;
  /** Meta's own id. It is what Meta's support asks for, not a webhook key. */
  requestId: string | null;
  doneAt: string | null;
  /** Meta's sentence: a refusal, a decline, a dead token. */
  error: string | null;
  /** True only while something is still unrequested and the window is open. */
  retryAllowed: boolean;
}

export interface WhatsAppAccount {
  phoneNumberId: string;
  businessAccountId: string;
  graphVersion: string;
  /** The Meta app that issued the token; null on rows connected before it was asked for. */
  appId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  businessName: string | null;
  status: string;
  /** `MANUAL` rows were typed in; `EMBEDDED_SIGNUP` rows came from Meta's dialog. */
  source: "MANUAL" | "EMBEDDED_SIGNUP";
  /** True when the number is also usable in the WhatsApp Business app. */
  onBizApp: boolean;
  /** The 24-hour synchronisation, in the shape this screen reads. */
  sync: CoexistenceSync;
  /** When the business token lapses. Null means never-expiring or unknown. */
  tokenExpiresAt: string | null;
  lastVerifiedAt: string | null;
  lastCheckAt: string | null;
  failureReason: string | null;
  accessTokenHint: string;
  verifyTokenHint: string;
  appSecretHint: string | null;
  webhook: WebhookFacts;
}

/** Where the flow stands, as the API computes it. `details` = nothing stored. */
export type ConnectionStage = "details" | "webhook" | "live" | "error";

export interface ConnectionPayload {
  account: WhatsAppAccount | null;
  stage: ConnectionStage;
  callbackUrl: string | null;
}

export interface ConnectResult {
  ok: boolean;
  summary: string;
  checks: CheckResult[];
  account: WhatsAppAccount | null;
}

/** What the page keeps after an attempt, whether the API answered or threw. */
export interface Verdict {
  ok: boolean;
  summary: string;
  checks: CheckResult[];
}

export interface ConnectInput {
  accessToken: string;
  phoneNumberId: string;
  /** Optional: only image-header templates need it. */
  appId?: string;
  appSecret: string;
  graphVersion: string;
  businessAccountId: string;
}

/**
 * What a customer sees when they open the chat. The first three come from the
 * stored phone row; the rest are read live from the profile edge, because Meta
 * keeps no column for them here.
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
  connected: boolean;
  /** True only when these facts came from Meta on this request. */
  live: boolean;
  /** Why the live half is missing; the stored facts are still present. */
  problem: string | null;
  profile: BusinessProfileFacts | null;
}

export type QrFormat = "SVG" | "PNG";

/**
 * One QR code and its short link. `imageUrl` points at Meta's CDN, not ours, so
 * an update reply (which omits it) must not be allowed to blank it out.
 */
export interface QrCode {
  code: string;
  prefilledMessage: string;
  shortLink: string;
  imageUrl: string | null;
}

export interface QrCodeList {
  /** False means no number is stored, so there is nothing to list. */
  connected: boolean;
  /** Meta's ceiling per number: 2,000. */
  limit: number;
  codes: QrCode[];
}

/** 200 with `ok: false` is a verdict, not an error — only transport fails throw. */
export function connectWhatsApp(input: ConnectInput): Promise<ConnectResult> {
  return request<ConnectResult>("/v1/whatsapp/connect", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchConnection(): Promise<ConnectionPayload> {
  return request<ConnectionPayload>("/v1/whatsapp/connection", { method: "GET" });
}

/** One Graph read per call: the profile edge, for the stored number. */
export function fetchBusinessProfile(): Promise<BusinessProfilePayload> {
  return request<BusinessProfilePayload>("/v1/whatsapp/profile", {
    method: "GET",
  });
}

export function disconnectWhatsApp(): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>("/v1/whatsapp/connection", {
    method: "DELETE",
  });
}

/** Asks Meta again for whatever the 24-hour sync is still missing. */
export function startHistorySync(): Promise<{ sync: CoexistenceSync }> {
  return request<{ sync: CoexistenceSync }>("/v1/whatsapp/connection/sync", {
    method: "POST",
  });
}

export function rotateVerifyToken(): Promise<{
  rotated: boolean;
  verifyToken: string | null;
}> {
  return request("/v1/whatsapp/verify-token/rotate", { method: "POST" });
}

/**
 * Forces a Graph re-check; used by "Check again" on the error and live panels.
 */
export function checkConnection(): Promise<{
  state: "none" | "pending" | "live" | "error";
  reason: string | null;
}> {
  return request("/v1/whatsapp/check", { method: "POST" });
}

/** One Graph read per call, like the profile: this is not a cached list. */
export function fetchQrCodes(): Promise<QrCodeList> {
  return request<QrCodeList>("/v1/whatsapp/qr-codes", { method: "GET" });
}

/**
 * Creating is what puts the image on Meta's CDN; the reply carries `imageUrl`
 * for the format asked for here.
 */
export function createQrCode(input: {
  prefilledMessage: string;
  format: QrFormat;
}): Promise<{ code: QrCode }> {
  return request<{ code: QrCode }>("/v1/whatsapp/qr-codes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Only the prefilled message changes. The reply omits the image, because the
 * code — and therefore the printed image — is unchanged.
 */
export function updateQrCode(
  code: string,
  prefilledMessage: string,
): Promise<{ code: QrCode }> {
  return request<{ code: QrCode }>(
    `/v1/whatsapp/qr-codes/${encodeURIComponent(code)}`,
    { method: "PATCH", body: JSON.stringify({ prefilledMessage }) },
  );
}

export function deleteQrCode(code: string): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(
    `/v1/whatsapp/qr-codes/${encodeURIComponent(code)}`,
    { method: "DELETE" },
  );
}

/**
 * Whether this server can run Meta's one-click dialog. `enabled` is false when
 * the operator has not installed a platform Meta app yet, and the page then
 * leads with the credentials form instead.
 */
export interface SignupConfig {
  enabled: boolean;
  appId: string | null;
  configId: string | null;
  graphVersion: string;
}

export function fetchSignupConfig(): Promise<SignupConfig> {
  return request<SignupConfig>("/v1/whatsapp/signup-config", { method: "GET" });
}

/** What Meta's dialog handed the browser: no token, no secret. */
export interface EmbeddedSignupInput {
  code: string;
  wabaId: string;
  /**
   * Absent when Meta finished with the business account alone — a number that
   * stays in use in the WhatsApp Business app. The server resolves it then.
   */
  phoneNumberId?: string;
}

/**
 * The server trades the code, proves the number belongs to the authorised
 * account, subscribes the app and records the token's expiry. A refusal throws
 * `ApiError` with one sentence; there is no per-field breakdown to render.
 */
export function connectEmbeddedSignup(
  input: EmbeddedSignupInput,
): Promise<{ account: WhatsAppAccount; summary: string }> {
  return request<{ account: WhatsAppAccount; summary: string }>(
    "/v1/whatsapp/embedded-signup",
    { method: "POST", body: JSON.stringify(input) },
  );
}
