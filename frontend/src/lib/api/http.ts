/**
 * The one place an authenticated request is made.
 *
 * It lives outside `features/` because the workspace shell needs a status call
 * and a shell that imports a feature is a shell that will break when the
 * feature moves.
 */
export const BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api"
).replace(/\/+$/, "");

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

async function authorise(): Promise<Headers> {
  // Imported lazily so a page that never calls the API does not pull the
  // Supabase client into its bundle.
  const { createClient } = await import("@/lib/supabase/client");
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
export function describe(body: unknown, status: number): string {
  if (body && typeof body === "object" && "message" in body) {
    const { message } = body as { message: unknown };

    if (Array.isArray(message)) return message.join(" ");
    if (typeof message === "string" && message.trim()) return message;
  }

  if (status === 401) return "Your session has expired. Sign in again and retry.";
  if (status === 429) return "Too many attempts. Wait a minute and try again.";
  if (status >= 500) return "The API failed while handling that request.";

  return `The request failed (HTTP ${status}).`;
}

export async function request<T>(path: string, init: RequestInit): Promise<T> {
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
