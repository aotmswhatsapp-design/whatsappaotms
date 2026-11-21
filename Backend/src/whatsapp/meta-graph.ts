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

/** The two formats Meta renders. SVG is the one to put on printed matter. */
export type QrImageFormat = "SVG" | "PNG";

/**
 * One entry on the WABA's `message_templates` edge. Only `id`, `name` and
 * `status` are guaranteed: `quality_score` appears only for approved templates
 * and `rejected_reason` only for rejected ones, so everything else is optional.
 */
export interface MessageTemplateDetails {
  id: string;
  name: string;
  status?: string;
  category?: string;
  language?: string;
  quality_score?: { score?: string } | string | null;
  rejected_reason?: string | null;
  components?: unknown;
  parameter_format?: string;
}

/** What a creation call accepts, already assembled into Meta's components. */
export interface MessageTemplateDraft {
  name: string;
  category: string;
  language: string;
  parameter_format: string;
  components: unknown[];
}

/** Meta answers a creation with the new id and the review verdict so far. */
export interface MessageTemplateCreated {
  id: string;
  status?: string;
  category?: string;
}

/**
 * One entry on the phone number's `message_qrdls` edge. `code` is the short
 * link's identifier, `deep_link_url` is what goes on a poster and
 * `qr_image_url` is Meta's rendered image on their CDN — it is not ours, so it
 * can move or expire and the list is the only place that knows the current one.
 */
export interface QrCodeDetails {
  code: string;
  prefilled_message?: string;
  deep_link_url?: string;
  qr_image_url?: string;
}

/**
 * The buckets `analytics` on a WABA answers with.
 *
 * `start` and `end` are Unix seconds, exactly as `start(…).end(…)` asked for
 * them; the caller decides how to render a window. Volume arrives as `sent`
 * and `delivered` for every product type, incoming included — there is no
 * separate inbound metric to read.
 */
export interface WabaAnalyticsPoint {
  start: number | null;
  end: number | null;
  sent: number | null;
  delivered: number | null;
}

export interface WabaAnalyticsRead {
  points: WabaAnalyticsPoint[];
  currency: string | null;
}

/**
 * One pricing category's volume and cost over a window. `cost` is null when
 * Meta withheld it — Solution-Partner billing reports volume without a
 * figure, and a `0` would read as "this was free".
 */
export interface PricingPoint {
  category: string;
  volume: number | null;
  cost: number | null;
}

export interface PricingRead {
  points: PricingPoint[];
  currency: string | null;
}

export type AnalyticsGranularity = "DAY" | "HALF_HOUR" | "MONTHLY";

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

  /**
   * Every QR code and short link on the number. Also answers `{ data: [] }` for
   * a number that has none, which is an empty screen rather than an error.
   *
   * `qr_image_url` is asked for explicitly because without it the page can list
   * links but cannot show the code. A version that does not expose it on this
   * edge answers code 100; the retry without `fields` still returns a usable
   * list, so one missing field never costs the whole screen.
   */
  async listQrCodes(
    version: string,
    phoneNumberId: string,
    token: string,
  ): Promise<QrCodeDetails[]> {
    const url = this.urlOf(version, [phoneNumberId, "message_qrdls"]);
    const asked = new URL(url);
    asked.searchParams.set(
      "fields",
      "code,prefilled_message,deep_link_url,qr_image_url",
    );

    try {
      const payload = await this.send<{ data?: QrCodeDetails[] }>(asked, {
        method: "GET",
        token,
      });

      return payload.data ?? [];
    } catch (error) {
      if (!(error instanceof MetaRequestError) || error.code !== 100) throw error;

      const payload = await this.send<{ data?: QrCodeDetails[] }>(url, {
        method: "GET",
        token,
      });

      return payload.data ?? [];
    }
  }

  /**
   * Creating puts the message and the format in the body and answers with the
   * new code plus, when the format was asked for, the rendered image.
   */
  createQrCode(
    version: string,
    phoneNumberId: string,
    token: string,
    input: { message: string; format: QrImageFormat },
  ): Promise<QrCodeDetails> {
    return this.send<QrCodeDetails>(
      this.urlOf(version, [phoneNumberId, "message_qrdls"]),
      {
        method: "POST",
        token,
        body: {
          prefilled_message: input.message,
          generate_qr_image: input.format,
        },
      },
    );
  }

  /**
   * Updating is a POST to the same edge with the code in the body — Meta does
   * not take a PATCH on the code's own path. `qr_image_url` is absent from the
   * reply, so callers re-list rather than assuming the image changed.
   */
  updateQrCode(
    version: string,
    phoneNumberId: string,
    token: string,
    code: string,
    message: string,
  ): Promise<QrCodeDetails> {
    return this.send<QrCodeDetails>(
      this.urlOf(version, [phoneNumberId, "message_qrdls"]),
      { method: "POST", token, body: { code, prefilled_message: message } },
    );
  }

  /** Answers `{ success: true }`; the caller only cares that it did not throw. */
  async deleteQrCode(
    version: string,
    phoneNumberId: string,
    token: string,
    code: string,
  ): Promise<void> {
    await this.send<{ success?: boolean }>(
      this.urlOf(version, [phoneNumberId, "message_qrdls", code]),
      { method: "DELETE", token },
    );
  }

  /**
   * Every template on the account, newest first as Meta orders them.
   *
   * `complete` matters more than it looks: a caller that mirrors deletions must
   * not treat the page cap as "these are all of them", or every template past
   * the cap would be marked deleted. The field list is asked for in full and
   * retried without the newer fields on code 100, so a version that does not
   * expose `parameter_format` still returns a usable list instead of failing.
   */
  async listMessageTemplates(
    version: string,
    businessAccountId: string,
    token: string,
  ): Promise<{ items: MessageTemplateDetails[]; complete: boolean }> {
    const items: MessageTemplateDetails[] = [];
    const full = "id,name,status,category,language,quality_score,rejected_reason,components,parameter_format";
    const minimal = "id,name,status,category,language,components";

    let next: string | null = this.urlOf(version, [
      businessAccountId,
      "message_templates",
    ]).toString();

    const withFields = (url: string, fields: string): string => {
      const asked = new URL(url);
      asked.searchParams.set("fields", fields);
      asked.searchParams.set("limit", "200");
      return asked.toString();
    };

    let fields = full;
    let first = withFields(next, fields);

    for (let page = 0; page < 5 && next !== null; page += 1) {
      let payload: {
        data?: MessageTemplateDetails[];
        paging?: { next?: string };
      };

      try {
        payload = await this.send<{
          data?: MessageTemplateDetails[];
          paging?: { next?: string };
        }>(new URL(first), { method: "GET", token });
      } catch (error) {
        // Only the first page carries our field list; a later page failing is a
        // real failure and must not silently truncate the account.
        if (page !== 0 || !(error instanceof MetaRequestError) || error.code !== 100) {
          throw error;
        }

        fields = minimal;
        first = withFields(next, fields);
        payload = await this.send<{
          data?: MessageTemplateDetails[];
          paging?: { next?: string };
        }>(new URL(first), { method: "GET", token });
      }

      items.push(...(payload.data ?? []));
      next = payload.paging?.next ?? null;
      // Paging links are absolute and already carry the field list.
      if (next !== null) first = next;
    }

    return { items, complete: next === null };
  }

  /**
   * Creating answers `{ id, status, category }`. The template enters review
   * immediately; `status` is Meta's first word on it, not a final verdict.
   */
  createMessageTemplate(
    version: string,
    businessAccountId: string,
    token: string,
    draft: MessageTemplateDraft,
  ): Promise<MessageTemplateCreated> {
    return this.send<MessageTemplateCreated>(
      this.urlOf(version, [businessAccountId, "message_templates"]),
      { method: "POST", token, body: draft },
    );
  }

  /**
   * Messaging volume on the WABA, bucketed by granularity.
   *
   * `productTypes` narrows the read to Meta's product classes (0 template,
   * 2 non-template, 100 incoming), which is the only way the API splits
   * inbound from outbound. The whole `analytics.…` expression travels in
   * `fields` because it is a field argument, not a query parameter.
   */
  async getWabaAnalytics(
    version: string,
    businessAccountId: string,
    token: string,
    query: {
      start: number;
      end: number;
      granularity: AnalyticsGranularity;
      productTypes?: number[];
    },
  ): Promise<WabaAnalyticsRead> {
    const expression = [
      `analytics.start(${query.start}).end(${query.end}).granularity(${query.granularity})`,
      query.productTypes?.length
        ? `.product_types(${query.productTypes.join(",")})`
        : "",
    ].join("");

    const payload = await this.send<Record<string, unknown>>(
      this.fieldUrl(version, businessAccountId, expression),
      { method: "GET", token },
    );

    const analytics = isRecord(payload.analytics) ? payload.analytics : payload;
    const raw = Array.isArray(analytics.data_points)
      ? analytics.data_points
      : Array.isArray(analytics.data)
        ? analytics.data
        : [];

    return {
      points: raw.filter(isRecord).map((point) => ({
        start: secondsOf(point.start),
        end: secondsOf(point.end),
        sent: numberOf(point.sent) ?? numberOf(point.messages),
        delivered: numberOf(point.delivered),
      })),
      currency: textOf(payload.currency) ?? textOf(analytics.currency),
    };
  }

  /**
   * What the window cost, per pricing category.
   *
   * The answer is a group per dimension value, each with its own data points;
   * the groups are flattened here so callers sum one list. A point that names
   * its metric carries the figure in `value`; one that carries `volume` and
   * `cost` directly is read as-is.
   */
  async getPricingAnalytics(
    version: string,
    businessAccountId: string,
    token: string,
    start: number,
    end: number,
  ): Promise<PricingRead> {
    const expression = [
      `pricing_analytics.start(${start}).end(${end}).granularity(DAILY)`,
      ".metric_types(VOLUME,COST)",
      ".dimensions(PRICING_CATEGORY)",
    ].join("");

    const payload = await this.send<Record<string, unknown>>(
      this.fieldUrl(version, businessAccountId, expression),
      { method: "GET", token },
    );

    const root = payload.pricing_analytics;
    const groups = isRecord(root)
      ? Array.isArray(root.data)
        ? root.data
        : [root]
      : Array.isArray(root)
        ? root
        : [];

    const points: PricingPoint[] = [];

    for (const group of groups) {
      if (!isRecord(group)) continue;

      const raw = Array.isArray(group.data_points) ? group.data_points : [];

      for (const point of raw) {
        if (!isRecord(point)) continue;

        const category = textOf(point.pricing_category) ?? textOf(point.category);
        if (!category) continue;

        const metric = (textOf(point.metric_type) ?? "").toUpperCase();
        const value = numberOf(point.value);
        const volume = numberOf(point.volume) ?? (metric === "VOLUME" ? value : null);
        const cost = numberOf(point.cost) ?? (metric === "COST" ? value : null);

        points.push({ category, volume, cost });
      }
    }

    return {
      points,
      currency:
        textOf(payload.currency) ??
        (isRecord(root) ? textOf(root.currency) : null),
    };
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
    const url = this.urlOf(version, path);
    url.searchParams.set("fields", fields);

    return this.send<T>(url, { method: "GET", token });
  }

  private urlOf(version: string, path: string[]): URL {
    return new URL(
      [this.base, encodeURIComponent(version), ...path.map(encodeURIComponent)].join("/"),
    );
  }

  /** A node read whose field list is an argument expression, not a list. */
  private fieldUrl(version: string, node: string, fields: string): URL {
    const url = this.urlOf(version, [node]);
    url.searchParams.set("fields", fields);
    return url;
  }

  private async send<T>(
    url: URL,
    init: {
      method: "GET" | "POST" | "DELETE";
      token?: string;
      body?: unknown;
    },
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Meta sends counts as numbers, and occasionally as numeric strings. */
function numberOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/** Analytics windows are Unix seconds; a string is parsed back to one. */
function secondsOf(value: unknown): number | null {
  const parsed = numberOf(value);

  return parsed === null ? null : Math.round(parsed);
}
