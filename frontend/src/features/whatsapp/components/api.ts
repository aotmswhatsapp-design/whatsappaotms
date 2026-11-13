import { createClient } from "@/lib/supabase/client";

export type CheckState = "ok" | "failed" | "skipped";

export interface CheckResult {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
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
  lastVerifiedAt: string | null;
  accessTokenHint: string;
  verifyTokenHint: string;
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
  verifyToken: string;
  graphVersion: string;
  businessAccountId: string;
}

/** A failure we can explain on screen, with the status that caused it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api"
).replace(/\/+$/, "");

async function authorise(): Promise<Headers> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new ApiError(401, "Your session has expired. Sign in again and retry.");
  }

  return new Headers({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  });
}

/**
 * Nest returns `{ message: string | string[] }` for both validation failures
 * and thrown HTTP exceptions; flattening keeps one readable sentence.
 */
function describe(body: unknown, status: number): string {
  if (body && typeof body === "object" && "message" in body) {
    const { message } = body as { message: unknown };

    if (Array.isArray(message)) return message.join(" ");
    if (typeof message === "string" && message.trim()) return message;
  }

  if (status === 401) return "Your session has expired. Sign in again and retry.";
  if (status === 429) return "Too many attempts. Wait a minute and try again.";
  if (status >= 500) return "The API failed while checking these details.";

  return `The request failed (HTTP ${status}).`;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let headers: Headers;

  try {
    headers = await authorise();
  } catch (error) {
    throw error instanceof ApiError
      ? error
      : new ApiError(401, "Could not read your session.");
  }

  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, headers, cache: "no-store" });
  } catch {
    throw new ApiError(
      0,
      `Could not reach the API at ${BASE_URL}. Is the backend running?`,
    );
  }

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new ApiError(response.status, describe(payload, response.status));
  }

  return payload as T;
}

/** 200 with `ok: false` is a verdict, not an error — only transport fails throw. */
export function connectWhatsApp(input: ConnectInput): Promise<ConnectResult> {
  return request<ConnectResult>("/v1/whatsapp/connect", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchConnection(): Promise<{ account: WhatsAppAccount | null }> {
  return request<{ account: WhatsAppAccount | null }>("/v1/whatsapp/connection", {
    method: "GET",
  });
}

export function disconnectWhatsApp(): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>("/v1/whatsapp/connection", {
    method: "DELETE",
  });
}
