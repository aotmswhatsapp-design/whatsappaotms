import { request, upload } from "@/lib/api/http";

export { ApiError } from "@/lib/api/http";

export type TemplateCategory = "AUTHENTICATION" | "MARKETING" | "UTILITY";
export type ParameterFormat = "NAMED" | "POSITIONAL";
export type HeaderFormat = "TEXT" | "IMAGE";
export type TemplateButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE";

/** One button, in the shape `POST /v1/templates` accepts. */
export interface TemplateButton {
  type: TemplateButtonType;
  /** Label. A copy-code button has none; Meta labels it for you. */
  text?: string;
  /** URL buttons only; may contain `{{1}}`. */
  url?: string;
  /** The rendered address Meta asks for when the URL carries a variable. */
  urlExample?: string;
  phoneNumber?: string;
  codeExample?: string;
}

/**
 * One template as Meta holds it. `components` is Meta's own array — the same
 * JSON creation sent — so the preview reads it without a second mapping.
 */
export interface TemplateFacts {
  id: string;
  metaId: string | null;
  name: string;
  language: string;
  category: string;
  parameterFormat: string;
  status: string;
  qualityScore: string | null;
  rejectedReason: string | null;
  components: unknown;
  /** True when we hold a sample for this row's IMAGE header. */
  hasMedia: boolean;
  /** Where that copy lives, so an edit can keep the image it already has. */
  mediaPath: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `stale` means the list on screen is the cache and Meta could not be reached.
 * It is not an error: the rows are real, they may just be behind.
 */
export interface TemplateListPayload {
  connected: boolean;
  templates: TemplateFacts[];
  syncedAt: string | null;
  stale: boolean;
  warning?: string;
}

/** The draft the builder sends. The API validates every limit again. */
export interface TemplateDraft {
  name: string;
  category: TemplateCategory;
  language: string;
  parameterFormat: ParameterFormat;
  /** Omitted means a text header; the API still defaults to TEXT. */
  headerFormat?: HeaderFormat;
  header?: string;
  /** The path `uploadTemplateMedia` answered, required for IMAGE headers. */
  mediaPath?: string;
  body: string;
  footer?: string;
  buttons?: TemplateButton[];
  /** Variable token without braces (`1`, `first_name`) → its example value. */
  examples?: Record<string, string>;
}

export function fetchTemplates(refresh = false): Promise<TemplateListPayload> {
  return request<TemplateListPayload>(
    `/v1/templates${refresh ? "?refresh=1" : ""}`,
    { method: "GET" },
  );
}

/**
 * A fresh signed URL for the stored sample. It dies in five minutes, so the
 * edit screen asks on mount rather than holding one from the list.
 */
export function fetchTemplateMediaUrl(
  id: string,
): Promise<{ url: string; mime: string | null }> {
  return request(`/v1/templates/${id}/media`, { method: "GET" });
}

/** One row, for the detail screen's header. */
export function fetchTemplate(id: string): Promise<TemplateFacts> {
  return request<TemplateFacts>(`/v1/templates/${id}`, { method: "GET" });
}

/** One day of one template's numbers, as Meta bucketed it. */
export interface TemplateAnalyticsDay {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  /** Null when Meta withheld the figure rather than charged nothing. */
  spent: number | null;
}

/**
 * What the detail screen renders. `unavailable` names the sections Meta would
 * not answer for; the rest of the payload is still real.
 */
export interface TemplateAnalytics {
  templateId: string;
  templateName: string;
  /** Meta's per-template insights switch has been turned on for this WABA. */
  insightsEnabled: boolean;
  window: { days: number; start: string; end: string };
  currency: string | null;
  cost: {
    amountSpent: number | null;
    /** Recomputed as Σspent ÷ Σdelivered, never a sum of daily ratios. */
    perDelivered: number | null;
    perUrlClick: number | null;
  };
  performance: {
    /** Null when Meta could not be asked, so 0 is never mistaken for measured. */
    sent: number | null;
    delivered: number | null;
    read: number | null;
    clicked: number | null;
    /** Counted from this workspace's own messages: Meta has no replies metric. */
    uniqueReplies: number;
  };
  series: TemplateAnalyticsDay[];
  unavailable: string[];
  warning?: string;
}

export function fetchTemplateAnalytics(
  id: string,
  days: number,
): Promise<TemplateAnalytics> {
  return request<TemplateAnalytics>(
    `/v1/templates/${id}/analytics?days=${days}`,
    { method: "GET" },
  );
}

/**
 * Turns Meta's per-template insights on for the whole account. Irreversible on
 * Meta's side, so the screen asks before calling it.
 */
export function enableTemplateInsights(): Promise<{
  enabled: boolean;
  enabledAt: string;
}> {
  return request("/v1/templates/insights", { method: "POST" });
}

/**
 * Submitting is the only write: Meta creates the template and starts its
 * review. A 400 lists every field to fix; a 502 carries Meta's own sentence.
 */
export function createTemplate(draft: TemplateDraft): Promise<TemplateFacts> {
  return request<TemplateFacts>("/v1/templates", {
    method: "POST",
    body: JSON.stringify(draft),
  });
}

/**
 * What an edit may change. Name, language and parameter format are Meta's
 * fixed fields: a template is keyed on the first two and cannot switch the
 * third after creation, so they are absent from the payload by construction.
 */
export type TemplateUpdate = Omit<TemplateDraft, "name" | "language">;

/**
 * Edits a template at Meta. Components are replaced wholesale, so the whole
 * message travels even when only one line changed. A 400 names the state or
 * field that blocks it; a 502 carries Meta's own sentence.
 */
export function updateTemplate(
  id: string,
  change: TemplateUpdate,
): Promise<TemplateFacts> {
  return request<TemplateFacts>(`/v1/templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(change),
  });
}

/**
 * Deletes this language at Meta. The row stays here as a tombstone — campaigns
 * and statistics point at it — but the catalogue stops showing it.
 */
export function deleteTemplate(id: string): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(`/v1/templates/${id}`, {
    method: "DELETE",
  });
}

/** What a stored sample answers: where it lives and how to show it now. */
export interface UploadedTemplateMedia {
  path: string;
  /** Already signed, so the builder can paint the file it just chose. */
  previewUrl: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

/**
 * Stores a header image and answers its path. The bytes go to the API, which
 * validates them and keeps them in the private bucket; the Meta handle that
 * this file becomes is minted later, when the template is submitted.
 *
 * Content type is left to the browser: setting it by hand drops the multipart
 * boundary `fetch` generated.
 */
export function uploadTemplateMedia(
  file: File,
  name?: string,
): Promise<UploadedTemplateMedia> {
  const form = new FormData();

  form.append("file", file);

  if (name?.trim()) form.append("name", name.trim());

  return upload<UploadedTemplateMedia>("/v1/templates/media", form);
}
