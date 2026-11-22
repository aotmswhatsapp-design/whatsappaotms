import type { Metadata } from "next";

import { CampaignDetail } from "@/features/campaigns/components/campaign-detail";

export const metadata: Metadata = { title: "Campaign" };

/**
 * The id only exists at request time, and everything on the screen is fetched
 * with the browser's session token. Prerendering has nothing to draw, so this
 * route blocks instead of streaming a skeleton of nothing.
 */
export const instant = false;

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <CampaignDetail id={id} />;
}
