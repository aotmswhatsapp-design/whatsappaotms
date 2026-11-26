import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** Meta answers slowly on a bad day; never let a request hang the API. */
const TIMEOUT_MS = 10_000;

/**
 * An upload moves bytes, not JSON: 5 MB over a slow link can honestly take
 * longer than a read, and cutting it at ten seconds would report a failure for
 * a request Meta was still assembling.
 */
const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * Meta's hard ceiling on `template_analytics`: one read may name ten template
 * ids, not more. Exceeding it is rejected by Meta, so callers chunk against
 * this number rather than discovering the limit at runtime.
 */
export const TEMPLATE_IDS_PER_READ = 10;

/** Meta answers template analytics for ninety days back, and no further. */
export const TEMPLATE_ANALYTICS_WINDOW_DAYS = 90;

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
 * `GET /oauth/access_token` with a signup code. `expires_in` is present only
 * when the exchanged token itself expires; the authoritative lifetime is read
 * back with `debugToken` instead of trusting this field.
 */
export interface TokenExchangeResult {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

/** `GET /{waba-id}/phone_numbers?fields=id`. */
export interface PhoneNumberList {
  data?: { id?: string }[];
}

/**
 * `GET /debug_token`. `expires_at` is epoch seconds and 0 means "never"; a
 * missing field is reported as null so the caller can refuse to store a
 * connection whose lifetime is unknown.
 */
export interface TokenDebugResult {
  data?: { is_valid?: boolean; expires_at?: number };
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
 * One pricing breakdown row over a window. `cost` is null when Meta withheld
 * it — Solution-Partner billing reports volume without a figure, and a `0`
 * would read as "this was free".
 *
 * The breakdown columns are the dimensions the read asked for; a dimension not
 * requested is null, not empty, so a caller can tell "not asked" from "Meta
 * answered nothing".
 */
export interface PricingPoint {
  category: string | null;
  phoneNumber: string | null;
  country: string | null;
  pricingType: string | null;
  /** Meta's `lower:upper` volume tier, e.g. `0:750000`. */
  tier: string | null;
  /** Start of the bucket in Unix seconds; null if Meta omitted it. */
  start: number | null;
  volume: number | null;
  cost: number | null;
}

/**
 * How wide a pricing read should break its answer down.
 *
 * `TIER` is only populated when `PRICING_CATEGORY` and `COUNTRY` are asked for
 * as well — Meta omits the tier otherwise, so the two travel together.
 */
export interface PricingQuery {
  granularity?: PricingGranularity;
  dimensions?: PricingDimension[];
}

export type PricingGranularity = "DAILY" | "MONTHLY";

export type PricingDimension =
  | "PHONE"
  | "COUNTRY"
  | "PRICING_CATEGORY"
  | "PRICING_TYPE"
  | "TIER";

export interface PricingRead {
  points: PricingPoint[];
  currency: string | null;
}

export type AnalyticsGranularity = "DAY" | "HALF_HOUR" | "MONTHLY";

/**
 * One day of one template's numbers.
 *
 * `clicked` is the number of URL-button taps — the total, never the total plus
 * the unique count; `cost` arrives as a list of named figures rather than a
 * single number, because the same read can answer for spend, cost per delivery
 * and cost per click at once.
 */
export interface TemplateAnalyticsPoint {
  templateId: string | null;
  start: number | null;
  end: number | null;
  sent: number | null;
  delivered: number | null;
  read: number | null;
  clicked: number | null;
  /** What Meta charged that day. Null when it withheld the figure. */
  amountSpent: number | null;
  /** Meta's own ratio, kept for diagnosis; the window total is recomputed. */
  costPerDelivered: number | null;
  costPerClicked: number | null;
}

export interface TemplateAnalyticsRead {
  points: TemplateAnalyticsPoint[];
  currency: string | null;
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
   * Subscribes this app to the WhatsApp account's webhooks.
   *
   * Meta delivers an event only to apps subscribed to the account that owns the
   * number, and a connection made by hand does not subscribe on its own — so a
   * perfectly verified callback URL can still receive nothing. Calling this on
   * connect closes that gap; repeating it is accepted and changes nothing.
   */
  async subscribeApp(input: {
    version: string;
    businessAccountId: string;
    token: string;
  }): Promise<void> {
    const url = this.urlOf(input.version, [
      input.businessAccountId,
      "subscribed_apps",
    ]);

    await this.send(url, { method: "POST", token: input.token });
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
   * Edits an existing template by its own id — not by name.
   *
   * Only `category` and `components` travel: name, language and
   * `parameter_format` are fixed at creation and Meta rejects a call that
   * tries to change them. `components` replaces the whole set, so the caller
   * must send every part it wants to keep. Meta re-reviews an approved
   * template after an edit and answers `{ success: true }` without a verdict;
   * the outcome arrives later on the status webhook.
   */
  updateMessageTemplate(
    version: string,
    templateId: string,
    token: string,
    changes: { category?: string; components: unknown[] },
  ): Promise<{ success?: boolean }> {
    return this.send<{ success?: boolean }>(
      this.urlOf(version, [templateId]),
      { method: "POST", token, body: changes },
    );
  }

  /**
   * Deletes one language of a template.
   *
   * The edge is addressed by WABA and the row by `hsm_id`, while `name` stays
   * required alongside it — Meta keys templates on name plus language, so a
   * name alone would delete every language at once. Deleting an approved
   * template also blocks that name for new templates for 30 days; that is
   * Meta's rule, not something this call can opt out of.
   */
  async deleteMessageTemplate(
    version: string,
    businessAccountId: string,
    token: string,
    input: { name: string; id: string },
  ): Promise<void> {
    const url = this.urlOf(version, [businessAccountId, "message_templates"]);
    url.searchParams.set("name", input.name);
    url.searchParams.set("hsm_id", input.id);

    await this.send<{ success?: boolean }>(url, { method: "DELETE", token });
  }

  /**
   * Uploads a template's sample image and returns the handle Meta wants in
   * `header_handle`.
   *
   * Two calls, not one: the first opens a session and declares the file's
   * length and type, the second sends the bytes and answers `{ h: "4::…" }`.
   * The handle is opaque and lives 30 days, which is why the caller mints it in
   * the same request that creates the template instead of storing it for later
   * use.
   *
   * Addressed by app id, not by number: this is the one WhatsApp call whose
   * path is the Meta app rather than the WABA or the phone number.
   */
  async uploadTemplateMedia(input: {
    version: string;
    appId: string;
    token: string;
    bytes: Buffer;
    mime: string;
    fileName: string;
  }): Promise<string> {
    const session = await this.sendBinary<{ id?: string }>(
      this.uploadSessionUrl(input),
      { method: "POST", token: input.token },
    );

    const sessionId = session.id?.trim() ?? "";

    if (!sessionId.startsWith("upload:")) {
      throw new MetaShapeError("Meta opened no upload session for that file.");
    }

    const uploaded = await this.sendBinary<{ h?: string }>(
      // The session id is a path segment Meta documents verbatim; encoding its
      // colon would change which object it names.
      new URL(`${this.base}/${encodeURIComponent(input.version)}/${sessionId}`),
      {
        method: "POST",
        token: input.token,
        body: new Uint8Array(input.bytes),
        headers: { file_offset: "0", "content-type": input.mime },
      },
    );

    const handle = uploaded.h?.trim() ?? "";

    if (!handle) {
      throw new MetaShapeError("Meta stored the file but returned no handle.");
    }

    return handle;
  }

  /**
   * The WABA's billing currency (`INR`, `USD`, …).
   *
   * Read instead of guessed. Meta's analytics payloads do not carry a currency
   * of their own on every path, and every money figure AOTMS renders has to be
   * labelled with the currency the account is actually billed in — so this is
   * asked for once per sync and stored. A refusal here is not fatal: the sync
   * records a null and the UI says the currency is unknown rather than printing
   * a dollar sign over an amount that may be rupees.
   */
  async getWabaCurrency(
    version: string,
    businessAccountId: string,
    token: string,
  ): Promise<string | null> {
    const payload = await this.get<{ currency?: string }>(
      version,
      businessAccountId,
      "currency",
      token,
    );

    return textOf(payload.currency);
  }

  /**
   * Per-day numbers for one or more templates over at most ninety days.
   *
   * Not the `analytics.…` field expression the WABA reads use: this is its own
   * edge, and `template_ids` is a bracketed array. Meta caps one read at **ten**
   * ids, so the caller chunks; asking for more is refused here rather than
   * answered partially, because a silent half-read would understate spend.
   * Metrics are asked for together because they are charged as one read, and the
   * cost figures arrive split by name rather than as one number.
   */
  async getTemplateAnalytics(input: {
    version: string;
    businessAccountId: string;
    token: string;
    templateIds: string[];
    start: number;
    end: number;
  }): Promise<TemplateAnalyticsRead> {
    if (input.templateIds.length === 0) {
      return { points: [], currency: null };
    }

    if (input.templateIds.length > TEMPLATE_IDS_PER_READ) {
      throw new Error(
        `template_analytics accepts at most ${TEMPLATE_IDS_PER_READ} template ids per read; got ${input.templateIds.length}.`,
      );
    }

    const url = this.urlOf(input.version, [
      input.businessAccountId,
      "template_analytics",
    ]);

    url.searchParams.set("start", String(input.start));
    url.searchParams.set("end", String(input.end));
    url.searchParams.set("granularity", "DAILY");
    url.searchParams.set("metric_types", "sent,delivered,read,clicked,cost");
    url.searchParams.set(
      "template_ids",
      JSON.stringify(input.templateIds),
    );

    const payload = await this.send<Record<string, unknown>>(url, {
      method: "GET",
      token: input.token,
    });

    // One group per metric family, each holding the days. Both wrapper keys
    // appear in Meta's own examples, so the reader accepts either.
    const groups = Array.isArray(payload.data) ? payload.data : [];
    const points: TemplateAnalyticsPoint[] = [];

    for (const group of groups) {
      if (!isRecord(group)) continue;

      const raw = Array.isArray(group.data_points)
        ? group.data_points
        : Array.isArray(group.data)
          ? group.data
          : [];

      for (const point of raw) {
        if (!isRecord(point)) continue;

        const cost = costOf(point.cost);

        points.push({
          templateId: textOf(point.template_id),
          start: secondsOf(point.start),
          end: secondsOf(point.end),
          sent: numberOf(point.sent),
          delivered: numberOf(point.delivered),
          read: numberOf(point.read),
          clicked: clicksOf(point.clicked),
          amountSpent: cost.spent,
          costPerDelivered: cost.perDelivered,
          costPerClicked: cost.perClicked,
        });
      }
    }

    const first = groups.find(isRecord);

    return {
      points,
      currency: textOf(payload.currency) ?? (first ? textOf(first.currency) : null),
    };
  }

  /**
   * Turns per-template insights on for the whole WABA.
   *
   * One-way and irreversible, which is why the caller confirms it first. Meta
   * answers the WABA node itself rather than a sub-edge, so the switch travels
   * in the body.
   */
  async enableTemplateInsights(input: {
    version: string;
    businessAccountId: string;
    token: string;
  }): Promise<void> {
    await this.send(
      this.urlOf(input.version, [input.businessAccountId]),
      {
        method: "POST",
        token: input.token,
        body: { is_enabled_for_insights: true },
      },
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
   * What the window cost, broken down by the dimensions asked for.
   *
   * The answer is a group per dimension value, each with its own data points;
   * the groups are flattened here so callers read one list. A point that names
   * its metric carries the figure in `value`; one that carries `volume` and
   * `cost` directly is read as-is.
   *
   * `dimensions` defaults to the pricing category alone, which is what the
   * dashboard's spend card wants. The reconciliation sync asks for the full
   * set, because a breakdown that cannot name the country, the phone number or
   * the volume tier is not something anyone can check against an invoice.
   */
  async getPricingAnalytics(
    version: string,
    businessAccountId: string,
    token: string,
    start: number,
    end: number,
    query: PricingQuery = {},
  ): Promise<PricingRead> {
    const dimensions = query.dimensions?.length
      ? query.dimensions
      : (["PRICING_CATEGORY"] as PricingDimension[]);

    const expression = [
      `pricing_analytics.start(${start}).end(${end}).granularity(${query.granularity ?? "DAILY"})`,
      ".metric_types(VOLUME,COST)",
      `.dimensions(${dimensions.join(",")})`,
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

        // A breakdown read naming one category repeats it on the group rather
        // than on every point, so the group is the fallback.
        const metric = (textOf(point.metric_type) ?? "").toUpperCase();
        const value = numberOf(point.value);
        const volume = numberOf(point.volume) ?? (metric === "VOLUME" ? value : null);
        const cost = numberOf(point.cost) ?? (metric === "COST" ? value : null);

        points.push({
          category: category ?? textOf(group.pricing_category),
          phoneNumber: textOf(point.phone_number) ?? textOf(group.phone_number),
          country: textOf(point.country) ?? textOf(group.country),
          pricingType: textOf(point.pricing_type) ?? textOf(group.pricing_type),
          tier: textOf(point.tier) ?? textOf(group.tier),
          start: secondsOf(point.start),
          volume,
          cost,
        });
      }
    }

    return {
      points,
      currency:
        textOf(payload.currency) ??
        (isRecord(root) ? textOf(root.currency) : null),
    };
  }

  /**
   * Embedded Signup, step one. The dialog hands the browser a one-shot code;
   * only a server holding the app secret can trade it. GET with credentials in
   * the query string is the only shape Meta accepts here.
   */
  async exchangeCode(input: {
    version: string;
    clientId: string;
    clientSecret: string;
    code: string;
  }): Promise<string> {
    const url = this.urlOf(input.version, ["oauth", "access_token"]);
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
   * The numbers the WABA actually owns. The dialog tells the browser which one
   * was picked; this list is the server's proof that the account really
   * contains it, so one tenant cannot claim another's number.
   */
  async listBusinessPhoneNumberIds(input: {
    version: string;
    businessAccountId: string;
    token: string;
  }): Promise<string[]> {
    const url = this.urlOf(input.version, [
      input.businessAccountId,
      "phone_numbers",
    ]);
    url.searchParams.set("fields", "id");

    const payload = await this.send<PhoneNumberList>(url, {
      method: "GET",
      token: input.token,
    });
    const rows = Array.isArray(payload.data) ? payload.data : [];

    return rows
      .map((row) => row?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  /**
   * What the token actually is. `expires_at` is epoch seconds and 0 means
   * never; a missing value is returned as null so the caller can refuse to
   * store a connection whose lifetime is unknown.
   */
  async debugToken(input: {
    version: string;
    appId: string;
    appSecret: string;
    token: string;
  }): Promise<{ isValid: boolean; expiresAt: number | null }> {
    const url = this.urlOf(input.version, ["debug_token"]);
    url.searchParams.set("input_token", input.token);
    url.searchParams.set("access_token", `${input.appId}|${input.appSecret}`);

    const payload = await this.send<TokenDebugResult>(url, { method: "GET" });
    const data = payload.data ?? {};

    return {
      isValid: data.is_valid === true,
      expiresAt: typeof data.expires_at === "number" ? data.expires_at : null,
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

  /** The session URL names the file's length and type before any byte moves. */
  private uploadSessionUrl(input: {
    version: string;
    appId: string;
    bytes: Buffer;
    mime: string;
    fileName: string;
  }): URL {
    const url = new URL(
      `${this.base}/${encodeURIComponent(input.version)}/${encodeURIComponent(input.appId)}/uploads`,
    );

    url.searchParams.set("file_name", input.fileName);
    url.searchParams.set("file_length", String(input.bytes.length));
    url.searchParams.set("file_type", input.mime);

    return url;
  }

  /**
   * The binary counterpart of `send`.
   *
   * Kept separate rather than folded into `send`: every existing call carries
   * JSON, and the resumable upload is the only one that sends raw bytes and
   * uses the `OAuth` scheme Meta documents for it.
   */
  private async sendBinary<T>(
    url: URL,
    init: {
      method: "POST";
      token: string;
      body?: Uint8Array;
      headers?: Record<string, string>;
    },
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `OAuth ${init.token}`,
      ...(init.headers ?? {}),
    };

    let response: Response;

    try {
      response = await fetch(url, {
        method: init.method,
        headers,
        body: init.body,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "TimeoutError"
          ? `no answer within ${UPLOAD_TIMEOUT_MS / 1000}s`
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

/**
 * URL-button clicks for one day.
 *
 * `clicked` arrives as a list of named rows: `url_button` counts every tap and
 * `unique_url_button` counts distinct people who tapped. The unique row is a
 * subset of the total, so adding the rows together nearly doubles the count and
 * halves every cost per click derived from it. Only the total is read.
 *
 * A bare number, or rows with no `type`, still read as a single figure — those
 * shapes carry one row and nothing to confuse it with.
 */
function clicksOf(value: unknown): number | null {
  const direct = numberOf(value);

  if (direct !== null) return direct;

  if (!Array.isArray(value)) return null;

  let total: number | null = null;
  let untyped: number | null = null;

  for (const entry of value) {
    if (!isRecord(entry)) continue;

    const count = numberOf(entry.count) ?? numberOf(entry.value);

    if (count === null) continue;

    const type = textOf(entry.type);

    if (type === null) untyped = (untyped ?? 0) + count;
    else if (type.toLowerCase() === "url_button") total = count;
  }

  return total ?? untyped;
}

/**
 * The three cost figures Meta can return for one day.
 *
 * `cost` is a list of `{ type, amount }` — `amount_spent`, `cost_per_delivered`
 * and `cost_per_url_button_click` — rather than a bare number, so each is
 * matched by name. A bare number is read as the spend itself.
 */
function costOf(value: unknown): {
  spent: number | null;
  perDelivered: number | null;
  perClicked: number | null;
} {
  const empty: {
    spent: number | null;
    perDelivered: number | null;
    perClicked: number | null;
  } = { spent: null, perDelivered: null, perClicked: null };

  if (value === undefined || value === null) return empty;

  const bare = numberOf(value);

  if (bare !== null) return { ...empty, spent: bare };

  if (!Array.isArray(value)) {
    if (!isRecord(value)) return empty;

    return sortCost("", numberOf(value.amount), empty);
  }

  let result = empty;

  for (const entry of value) {
    if (!isRecord(entry)) continue;

    result = sortCost(
      textOf(entry.type) ?? "",
      numberOf(entry.amount) ?? numberOf(entry.value),
      result,
    );
  }

  return result;
}

function sortCost(
  type: string,
  amount: number | null,
  into: { spent: number | null; perDelivered: number | null; perClicked: number | null },
) {
  if (amount === null) return into;

  const name = type.toLowerCase();

  if (name.includes("deliver")) return { ...into, perDelivered: amount };
  if (name.includes("click")) return { ...into, perClicked: amount };

  return { ...into, spent: amount };
}
