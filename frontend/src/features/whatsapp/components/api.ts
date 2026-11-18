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
}

export interface WhatsAppAccount {
  phoneNumberId: string;
  businessAccountId: string;
  graphVersion: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  businessName: string | null;
  status: string;
  /** `MANUAL` rows were typed in; `EMBEDDED_SIGNUP` rows came from Meta's dialog. */
  source: "MANUAL" | "EMBEDDED_SIGNUP";
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
  appSecret: string;
  graphVersion: string;
  businessAccountId: string;
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

export function disconnectWhatsApp(): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>("/v1/whatsapp/connection", {
    method: "DELETE",
  });
}

export function rotateVerifyToken(): Promise<{
  rotated: boolean;
  verifyToken: string | null;
}> {
  return request("/v1/whatsapp/verify-token/rotate", { method: "POST" });
}

/** Forces a Graph re-check; used by "Check again" on the error and live panels. */
export function checkConnection(): Promise<{
  state: "none" | "pending" | "live" | "error";
  reason: string | null;
}> {
  return request("/v1/whatsapp/check", { method: "POST" });
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
  phoneNumberId: string;
}

/**
 * Throws an ApiError with one readable sentence on refusal: nothing was typed
 * here, so there is no per-field breakdown to show.
 */
export function connectEmbeddedSignup(
  input: EmbeddedSignupInput,
): Promise<{ account: WhatsAppAccount; summary: string }> {
  return request("/v1/whatsapp/embedded-signup", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
