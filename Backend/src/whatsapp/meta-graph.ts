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
 * The profile a customer sees when they open the chat. These fields live on
 * the phone number's `whatsapp_business_profile` edge, not on the phone node:
 * `verified_name` is NOT in this payload, which is why the service merges the
 * stored phone facts with this read instead of expecting them here.
 */
export interface BusinessProfileDetails {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  profile_picture_url?: string;
  websites?: string[];
  vertical?: string;
  messaging_product?: string;
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
   * The profile customers see. `whatsapp_business_profile` is a collection
   * node — it answers `{ data: [ … ] }` with at most one entry — so the
   * unwrapping belongs here rather than in every caller.
   */
  async getBusinessProfile(
    version: string,
    phoneNumberId: string,
    token: string,
  ): Promise<BusinessProfileDetails> {
    const payload = await this.getEdge<{ data?: BusinessProfileDetails[] }>(
      version,
      [phoneNumberId, "whatsapp_business_profile"],
      "about,address,description,email,profile_picture_url,websites,vertical",
      token,
    );

    // A number with nothing filled in can answer `{ data: [] }`. That is not a
    // failure — it means Meta holds no facts, which the card states plainly.
    return payload.data?.[0] ?? {};
  }

  private get<T>(
    version: string,
    node: string,
    fields: string,
    token: string,
  ): Promise<T> {
    return this.getEdge<T>(version, [node], fields, token);
  }

  /**
   * A node plus a sub-path (`{id}/whatsapp_business_profile`). Each segment is
   * encoded on its own: encoding the whole path would turn the separator into
   * `%2F` and Meta would answer 404.
   */
  private getEdge<T>(
    version: string,
    path: string[],
    fields: string,
    token: string,
  ): Promise<T> {
    const url = new URL(
      [this.base, encodeURIComponent(version), ...path.map(encodeURIComponent)].join("/"),
    );
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
