import type { Metadata } from "next";

import { PageHeader } from "@/components/workspace/page-header";
import { getNavItem } from "@/config/workspace-nav";
import { AnalyticsView } from "@/features/analytics/components/analytics-view";

const nav = getNavItem("/workspace/analytics");

export const metadata: Metadata = { title: nav.title };

/**
 * Thin server shell, like the templates screen: the figures are stored
 * snapshots served by the API, and reading them needs the browser's session
 * token. Nothing here is aggregated across workspaces.
 */
export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="What Meta reported for your templates: messages sent, delivered and read, and the charge behind them. Figures come from the last sync — press Sync now to pull the most recent ninety days."
        eyebrow={nav.group}
        title={nav.title}
      />

      <AnalyticsView />
    </div>
  );
}
