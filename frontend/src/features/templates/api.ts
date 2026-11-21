import { request } from "@/lib/api/http";

export { ApiError } from "@/lib/api/http";

export type TemplateCategory = "AUTHENTICATION" | "MARKETING" | "UTILITY";
export type ParameterFormat = "NAMED" | "POSITIONAL";
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
  header?: string;
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
 * Submitting is the only write: Meta creates the template and starts its
 * review. A 400 lists every field to fix; a 502 carries Meta's own sentence.
 */
export function createTemplate(draft: TemplateDraft): Promise<TemplateFacts> {
  return request<TemplateFacts>("/v1/templates", {
    method: "POST",
    body: JSON.stringify(draft),
  });
}
