import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** Meta answers slowly on a bad day; never let a request hang the API. */
const TIMEOUT_MS = 10_000;

export interface MetaErrorBody {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  /**
   * Where Meta puts the sentence a human can act on when `message` is only a
   * label like "(#100) Invalid parameter".
   */
  error_data?: { messaging_product?: string; details?: string };
}

/** Meta answered, and the answer was an error. Carries the code we classify on. */
export class MetaRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: MetaErrorBody,
  ) {
    super(body.message);
    this.name = "MetaRequestError";
  }

  get code(): number | undefined {
    return this.body.code;
  }

  /**
   * The most specific sentence Meta gave us: `error_data.details` explains a
   * rejection that `message` only names. Falls back to the envelope.
   */
  get explanation(): string {
    return (
      this.body.error_data?.details?.trim() ||
      this.body.message.trim() ||
      `Meta answered HTTP ${this.status}.`
    );
  }
}

/** We never reached Meta: DNS, TLS, or the timeout fired. */
export class MetaTransportError extends Error {
  constructor(readonly reason: string) {
    super(`Could not reach Meta: ${reason}`);
    this.name = "MetaTransportError";
  }
}

/** Meta answered 200, but the body is missing the field the flow needs. */
export class MetaShapeError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "MetaShapeError";
  }
}

export interface TokenExchangeResult {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

export interface PhoneNumberList {
  data?: { id?: string }[];
}

export interface PhoneNumberDetails {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  platform_type?: string;
}

export interface BusinessDetails {
  id: string;
  name?: string;
  verification_status?: string;
}

/**
 * The only place that knows Meta's wire format.
 *
 * The access token travels in the Authorization header rather than a query
 * string so it cannot leak into proxy or server logs. Errors are surfaced as
 * typed exceptions, because the codes are what make the UI's verdict specific
 * ("token rejected" vs "number not found") instead of a generic failure.
 *
 * Observed against the live Graph API: no token on a node ⇒ 400 code 104,
 * rejected token ⇒ 401/400 code 190, unknown object or version ⇒ 400 code 100
 * with the offending id quoted in the message.
 */
@Injectable()
export class MetaGraph {
  private readonly base: string;

  constructor(config: ConfigService) {
    this.base = (config.get<string>("META_GRAPH_BASE_URL") ?? "https://graph.facebook.com")
      .replace(/\/+$/, "");
  }

  getPhoneNumber(
    version: string,
    phoneNumberId: string,
    token: string,
  ): Promise<PhoneNumberDetails> {
    return this.get<PhoneNumberDetails>(
      version,
      phoneNumberId,
      "id,display_phone_number,verified_name,quality_rating,platform_type",
      token,
    );
  }

  getBusinessAccount(
    version: string,
    businessAccountId: string,
    token: string,
  ): Promise<BusinessDetails> {
    return this.get<BusinessDetails>(
      version,
      businessAccountId,
      "id,name,verification_status",
      token,
    );
  }

  /**
   * Embedded Signup, step one: the dialog hands the browser a one-shot code,
   * and only a server holding the app secret can trade it for a token. It goes
   * over GET with credentials in the query string because that is the only
   * shape Meta accepts for this endpoint.
   */
  async exchangeCode(input: {
    version: string;
    clientId: string;
    clientSecret: string;
    code: string;
  }): Promise<string> {
    const url = new URL(
      `${this.base}/${encodeURIComponent(input.version)}/oauth/access_token`,
    );
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("client_secret", input.clientSecret);
    url.searchParams.set("code", input.code);

    const payload = await this.send<TokenExchangeResult>(url, { method: "GET" });

    if (!payload.access_token) {
      throw new MetaShapeError(
        "Meta accepted the signup code but returned no access token.",
      );
    }

    return payload.access_token;
  }

  /**
   * Embedded Signup, step two: without this the account exists but Meta never
   * calls us, so the customer would wait in "pending" forever.
   */
  async subscribeApp(
    version: string,
    businessAccountId: string,
    token: string,
  ): Promise<void> {
    const url = new URL(
      `${this.base}/${encodeURIComponent(version)}/${encodeURIComponent(businessAccountId)}/subscribed_apps`,
    );

    await this.send<Record<string, unknown>>(url, { method: "POST", token });
  }

  /**
   * The numbers the WABA actually owns. The signup dialog tells the browser
   * which number was picked; this is the server's proof that the account
   * really contains it, so one tenant cannot claim another's number.
   */
  async listBusinessPhoneNumberIds(
    version: string,
    businessAccountId: string,
    token: string,
  ): Promise<string[]> {
    const url = new URL(
      `${this.base}/${encodeURIComponent(version)}/${encodeURIComponent(businessAccountId)}/phone_numbers`,
    );
    url.searchParams.set("fields", "id");

    const payload = await this.send<PhoneNumberList>(url, { method: "GET", token });
    const rows = Array.isArray(payload.data) ? payload.data : [];

    return rows
      .map((row) => row?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  private get<T>(
    version: string,
    node: string,
    fields: string,
    token: string,
  ): Promise<T> {
    const url = new URL(`${this.base}/${encodeURIComponent(version)}/${encodeURIComponent(node)}`);
    url.searchParams.set("fields", fields);

    return this.send<T>(url, { method: "GET", token });
  }

  private async send<T>(
    url: URL,
    init: { method: "GET" | "POST"; token?: string },
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.token) headers.authorization = `Bearer ${init.token}`;

    let response: Response;

    try {
      response = await fetch(url, {
        method: init.method,
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Node's fetch has no HTTP cache, so every verification reaches Meta.
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "TimeoutError"
          ? `no answer within ${TIMEOUT_MS / 1000}s`
          : error instanceof Error
            ? error.message
            : "unknown network failure";
      throw new MetaTransportError(reason);
    }

    const text = await response.text();
    const payload = parseJson(text);

    if (!response.ok) {
      const body = (payload as { error?: MetaErrorBody } | null)?.error;
      throw new MetaRequestError(
        response.status,
        body ?? { message: text.slice(0, 200) || response.statusText },
      );
    }

    if (!payload) {
      throw new MetaTransportError("Meta returned a body that is not JSON");
    }

    return payload as T;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
