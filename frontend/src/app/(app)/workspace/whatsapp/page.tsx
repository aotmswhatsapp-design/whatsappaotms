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
        description="Verify your Meta app's credentials, hand the callback URL to Meta, and watch the webhook go live. Nothing is stored until every value passes."
        eyebrow={nav.group}
        title={nav.title}
      />

      <WhatsAppConnection />
    </div>
  );
}
