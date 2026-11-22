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
    /** A discriminator the server chose, e.g. `WINDOW_CLOSED`. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function authorise(json = true): Promise<Headers> {
  // Imported lazily so a page that never calls the API does not pull the
  // Supabase client into its bundle.
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new ApiError(401, "Your session has expired. Sign in again and retry.");
  }

  const headers = new Headers({ authorization: `Bearer ${token}` });

  // Multipart sets its own content-type so fetch can add the boundary.
  if (json) headers.set("content-type", "application/json");

  return headers;
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
  const headers = await sessionHeaders();

  return send<T>(path, init, headers);
}

/**
 * A multipart POST. Separate from `request` because the JSON helper sets a
 * content-type, and a hand-set boundary is a broken upload.
 */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const headers = await sessionHeaders(false);

  return send<T>(path, { method: "POST", body: form }, headers);
}

/**
 * A request whose body is not JSON — the campaign report is CSV.
 *
 * Same session and same error handling as `request`; the difference is that
 * the body is taken as bytes instead of being run through `JSON.parse`.
 */
export async function download(path: string): Promise<Blob> {
  const headers = await sessionHeaders(false);

  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, `Could not reach the API at ${BASE_URL}.`);
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;

    throw new ApiError(
      response.status,
      describe(payload, response.status),
      codeOf(payload),
    );
  }

  return response.blob();
}

async function sessionHeaders(json = true): Promise<Headers> {
  try {
    return await authorise(json);
  } catch (error) {
    throw error instanceof ApiError
      ? error
      : new ApiError(401, "Could not read your session.");
  }
}

async function send<T>(
  path: string,
  init: RequestInit,
  headers: Headers,
): Promise<T> {
  let response: Response;
  const url = `${BASE_URL}${path}`;

  try {
    response = await fetch(url, { ...init, headers, cache: "no-store" });
  } catch {
    // A failed fetch cannot tell a dead host from a rejected preflight: the
    // browser reports both as one opaque network error. Name the caller's
    // origin so the next reader checks CORS_ORIGINS instead of restarting a
    // backend that is already healthy.
    const origin =
      typeof window === "undefined" ? "this origin" : window.location.origin;
    throw new ApiError(
      0,
      `Could not reach the API at ${BASE_URL} from ${origin}. Either the backend is down or ${origin} is missing from its CORS_ORIGINS.`,
    );
  }

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    // The API always explains a 404 in JSON. A 404 without one came from
    // something else wearing our host — a stale build, a proxy, or a
    // NEXT_PUBLIC_API_URL that points at the frontend — so name the URL.
    if (response.status === 404 && payload === null) {
      throw new ApiError(
        404,
        `${url} answered without a JSON body, so it is not this API. Check NEXT_PUBLIC_API_URL and restart the backend.`,
      );
    }

    throw new ApiError(
      response.status,
      describe(payload, response.status),
      codeOf(payload),
    );
  }

  return payload as T;
}

/** The server's machine-readable discriminator, when it sent one. */
function codeOf(body: unknown): string | undefined {
  if (body && typeof body === "object" && "code" in body) {
    const { code } = body as { code: unknown };
    if (typeof code === "string" && code.length > 0) return code;
  }

  return undefined;
}
