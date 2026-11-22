import type { Metadata } from "next";

import { CampaignsView } from "@/features/campaigns/components/campaigns-view";
import { getNavItem } from "@/config/workspace-nav";

const nav = getNavItem("/workspace/campaigns");

export const metadata: Metadata = { title: nav.title };

export default function CampaignsPage() {
  return <CampaignsView />;
}
