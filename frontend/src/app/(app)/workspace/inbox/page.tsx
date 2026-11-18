import type { Metadata } from "next";

import { PageHeader } from "@/components/workspace/page-header";
import { getNavItem } from "@/config/workspace-nav";
import { InboxView } from "@/features/inbox/components/inbox-view";

const nav = getNavItem("/workspace/inbox");

export const metadata: Metadata = { title: nav.title };

export default function InboxPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="Every WhatsApp conversation in one queue: read the thread, reply inside the 24-hour window, attach files, assign an agent and leave notes your customer never sees."
        eyebrow={nav.group}
        title={nav.title}
      />

      <InboxView />
    </div>
  );
}
