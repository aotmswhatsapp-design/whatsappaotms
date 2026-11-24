import type {
  AudienceSource,
  CampaignStatus,
  TemplateCategory,
} from "@prisma/client";

import { bindingsOf, type BindingMap } from "./campaign.values";
import {
  buttonUrlsOf,
  MESSAGE_STATUSES,
  type CampaignRow,
  type InsightBuckets,
} from "./campaigns.types";

/**
 * A campaign as the browser sees it.
 *
 * `insights` always carries all five statuses, zero-filled, because a missing
 * key is a React `undefined` on screen and a zero is not. There is no money
 * field and there will not be one: Meta bills per delivered message at a rate
 * it does not expose to the API.
 */
export interface CampaignView {
  id: string;
  name: string;
  status: CampaignStatus;
  template: {
    id: string;
    name: string;
    language: string;
    category: TemplateCategory;
  };
  audienceSource: AudienceSource;
  audienceTags: string[];
  variables: BindingMap;
  buttonUrls: Record<string, string>;
  optInConfirmed: boolean;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  counts: {
    total: number;
    sent: number;
    failed: number;
    skipped: number;
  };
  insights: Record<(typeof MESSAGE_STATUSES)[number], number>;
  createdAt: string;
}

export function campaignView(
  row: CampaignRow,
  insights: InsightBuckets = {},
): CampaignView {
  const filled = Object.fromEntries(
    MESSAGE_STATUSES.map((status) => [status, insights[status] ?? 0]),
  ) as CampaignView["insights"];

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    template: {
      id: row.template.id,
      name: row.template.name,
      language: row.template.language,
      category: row.template.category,
    },
    audienceSource: row.audienceSource,
    audienceTags: row.audienceTags,
    variables: bindingsOf(row.variables),
    buttonUrls: buttonUrlsOf(row.buttonUrls),
    optInConfirmed: row.optInConfirmed,
    scheduledAt: iso(row.scheduledAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    counts: {
      total: row.totalCount,
      sent: row.sentCount,
      failed: row.failedCount,
      skipped: row.skippedCount,
    },
    insights: filled,
    createdAt: row.createdAt.toISOString(),
  };
}

/** One recipient as the detail table draws it. */
export interface RecipientView {
  id: string;
  waId: string;
  contactName: string | null;
  /** Imported with the list; shown to the agent, never sent to Meta. */
  email: string | null;
  externalId: string | null;
  status: string;
  errorReason: string | null;
  delivery: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}

export function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
