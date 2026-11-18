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
        description="Connect your WhatsApp Business number in one step through Meta, or paste your own app's credentials. Nothing is stored until Meta confirms it."
        eyebrow={nav.group}
        title={nav.title}
      />

      <WhatsAppConnection />
    </div>
  );
}
