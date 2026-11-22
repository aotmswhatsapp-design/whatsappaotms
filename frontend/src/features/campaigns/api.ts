import { download, request } from "@/lib/api/http";
import type { TemplateShape } from "@/lib/templates/shape";

export { ApiError } from "@/lib/api/http";

/**
 * AOTMS campaigns, sent through the WhatsApp Cloud API.
 *
 * Meta's "Messaging campaigns in Meta Business Suite" is a different product
 * with no API, so nothing here reads or mirrors one. The shapes below are
 * `CampaignView` on the server, one mapping in one place.
 */
export type CampaignStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export type RecipientStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";

export type MessageStatus = "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED";

/**
 * How one `{{token}}` is filled: the same text for everyone, or something read
 * from the recipient's contact. A name without a fallback is refused by Meta,
 * so the server requires one.
 */
export type TokenBinding =
  | { kind: "static"; value: string }
  | { kind: "contact"; field: "name" | "waId"; fallback?: string };

/**
 * Delivery and read counts, read from the messages the webhook has updated.
 * They are not a separate tally: a campaign that reports "delivered" is
 * reporting what Meta actually confirmed.
 */
export interface CampaignInsights {
  QUEUED: number;
  SENT: number;
  DELIVERED: number;
  READ: number;
  FAILED: number;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  template: { id: string; name: string; language: string; category: string };
  audienceTags: string[];
  variables: Record<string, TokenBinding>;
  buttonUrls: Record<string, string>;
  optInConfirmed: boolean;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  counts: { total: number; sent: number; failed: number; skipped: number };
  insights: CampaignInsights;
  createdAt: string;
}

export interface CampaignOptions {
  templates: {
    id: string;
    name: string;
    language: string;
    category: string;
    shape: TemplateShape;
  }[];
  tags: string[];
  channel: { connected: boolean; display: string | null; phoneNumberId: string | null };
}

/** Who the current tags would reach, and the first few of them by name. */
export interface Audience {
  total: number;
  sample: { profileName: string | null; waId: string; phoneDisplay: string | null }[];
}

export interface Recipient {
  id: string;
  waId: string;
  contactName: string | null;
  status: RecipientStatus;
  errorReason: string | null;
  /** The message's own status, so "sent" here and "read" there cannot drift. */
  delivery: MessageStatus | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface CampaignDetail {
  campaign: Campaign;
  recipients: { items: Recipient[]; nextCursor: string | null };
}

/** What the form sends. The server validates every field again. */
export interface CampaignDraft {
  name: string;
  templateId: string;
  audienceTags: string[];
  variables: Record<string, TokenBinding>;
  buttonUrls: Record<string, string>;
  optInConfirmed: boolean;
  scheduledAt: string | null;
}

export function fetchCampaigns(status?: CampaignStatus): Promise<{ campaigns: Campaign[] }> {
  return request<{ campaigns: Campaign[] }>(
    `/v1/campaigns${status ? `?status=${status}` : ""}`,
    { method: "GET" },
  );
}

export function fetchCampaign(id: string, cursor?: string): Promise<CampaignDetail> {
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";

  return request<CampaignDetail>(`/v1/campaigns/${id}${suffix}`, { method: "GET" });
}

export function fetchCampaignOptions(): Promise<CampaignOptions> {
  return request<CampaignOptions>("/v1/campaigns/options", { method: "GET" });
}

/** `?tags=a,b` — commas are safe in the value, so each tag is escaped once. */
export function fetchAudience(tags: string[]): Promise<Audience> {
  const query = tags.map((tag) => encodeURIComponent(tag)).join(",");
  const suffix = tags.length > 0 ? `?tags=${query}` : "";

  return request<Audience>(`/v1/campaigns/audience${suffix}`, { method: "GET" });
}

export function createCampaign(draft: CampaignDraft): Promise<{ campaign: Campaign }> {
  return request<{ campaign: Campaign }>("/v1/campaigns", {
    method: "POST",
    body: JSON.stringify(draft),
  });
}

export function updateCampaign(
  id: string,
  draft: Partial<CampaignDraft>,
): Promise<{ campaign: Campaign }> {
  return request<{ campaign: Campaign }>(`/v1/campaigns/${id}`, {
    method: "PATCH",
    body: JSON.stringify(draft),
  });
}

export function deleteCampaign(id: string): Promise<{ deleted: true }> {
  return request<{ deleted: true }>(`/v1/campaigns/${id}`, { method: "DELETE" });
}

export function startCampaign(id: string): Promise<CampaignDetail> {
  return request<CampaignDetail>(`/v1/campaigns/${id}/start`, { method: "POST" });
}

export function pauseCampaign(id: string): Promise<CampaignDetail> {
  return request<CampaignDetail>(`/v1/campaigns/${id}/pause`, { method: "POST" });
}

export function resumeCampaign(id: string): Promise<CampaignDetail> {
  return request<CampaignDetail>(`/v1/campaigns/${id}/resume`, { method: "POST" });
}

export function cancelCampaign(id: string): Promise<CampaignDetail> {
  return request<CampaignDetail>(`/v1/campaigns/${id}/cancel`, { method: "POST" });
}

/** One real message to one number. It is not a recipient and is not counted. */
export function testCampaign(id: string, to: string): Promise<{ messageId: string }> {
  return request<{ messageId: string }>(`/v1/campaigns/${id}/test`, {
    method: "POST",
    body: JSON.stringify({ to }),
  });
}

/** The recipient report the PRD asks for, as the browser's own download. */
export function fetchRecipientsCsv(id: string): Promise<Blob> {
  return download(`/v1/campaigns/${id}/recipients.csv`);
}
