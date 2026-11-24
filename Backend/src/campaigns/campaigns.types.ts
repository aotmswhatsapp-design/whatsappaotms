import type { MessageStatus, Prisma } from "@prisma/client";

/**
 * The one read shape every campaign endpoint uses. Selecting the template
 * alongside the campaign is deliberate: a send needs the components Meta
 * approved, and re-reading them per recipient would be a second truth.
 *
 * `template` is joined, not snapshotted, so a campaign still shows the
 * template's current quality and category. Name and language are snapshotted
 * on the row because those are what the send must repeat verbatim.
 */
export const CAMPAIGN_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  status: true,
  templateName: true,
  templateLanguage: true,
  templateCategory: true,
  audienceSource: true,
  audienceTags: true,
  variables: true,
  buttonUrls: true,
  optInConfirmed: true,
  scheduledAt: true,
  startedAt: true,
  completedAt: true,
  pausedAt: true,
  totalCount: true,
  sentCount: true,
  failedCount: true,
  skippedCount: true,
  createdAt: true,
  template: {
    select: {
      id: true,
      name: true,
      language: true,
      category: true,
      components: true,
      parameterFormat: true,
    },
  },
} satisfies Prisma.CampaignSelect;

export type CampaignRow = Prisma.CampaignGetPayload<{
  select: typeof CAMPAIGN_SELECT;
}>;

/** Message statuses are the delivery truth, so they are always all reported. */
export const MESSAGE_STATUSES = [
  "QUEUED",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
] as const satisfies readonly MessageStatus[];

export type InsightBuckets = Partial<Record<MessageStatus, number>>;

/**
 * What a send needs from the workspace's number: the credentials Meta wants,
 * plus the row id, because the conversation upsert keys on `accountId`.
 *
 * Structural rather than extending `AccountCredentials`: this module needs the
 * shape, not the inbox's types, and the sender accepts it as-is.
 */
export interface SendAccount {
  id: string;
  phoneNumberId: string;
  graphVersion: string;
  accessTokenCipher: string;
}

/** The button map is JSON in the column; the client sends strings only. */
export function buttonUrlsOf(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }

  const out: Record<string, string> = {};

  for (const [index, value] of Object.entries(
    input as Record<string, unknown>,
  )) {
    if (typeof value === "string") out[index] = value;
  }

  return out;
}
