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
}

/** We never reached Meta: DNS, TLS, or the timeout fired. */
export class MetaTransportError extends Error {
  constructor(readonly reason: string) {
    super(`Could not reach Meta: ${reason}`);
    this.name = "MetaTransportError";
  }
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

  private async get<T>(
    version: string,
    node: string,
    fields: string,
    token: string,
  ): Promise<T> {
    const url = new URL(`${this.base}/${encodeURIComponent(version)}/${encodeURIComponent(node)}`);
    url.searchParams.set("fields", fields);

    let response: Response;

    try {
      response = await fetch(url, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
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
