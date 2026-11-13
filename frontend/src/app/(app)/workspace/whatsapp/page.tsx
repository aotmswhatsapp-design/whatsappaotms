import type { Metadata } from "next";

import { PageHeader } from "@/components/workspace/page-header";
import { getNavItem } from "@/config/workspace-nav";
import { WhatsAppConnection } from "@/features/whatsapp/components/whatsapp-connection";

const nav = getNavItem("/workspace/whatsapp");

export const metadata: Metadata = { title: nav.title };

export default function WhatsAppPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="Enter the five values from your Meta app. The server asks Meta's Graph API about each one and stores them encrypted — only when every check passes."
        eyebrow={nav.group}
        title={nav.title}
      />

      <WhatsAppConnection />
    </div>
  );
}
