import type { Metadata } from "next";

import { PageHeader } from "@/components/workspace/page-header";
import { getNavItem } from "@/config/workspace-nav";
import { WhatsAppPanel } from "@/features/whatsapp/components/whatsapp-panel";
import { fetchAccessRole } from "@/lib/api/server-access";

const nav = getNavItem("/workspace/whatsapp");

export const metadata: Metadata = { title: nav.title };

/**
 * The connection is the workspace's, so the wizard is the owner's alone. An
 * invited member sees the same number read-only instead of being asked to
 * connect one of their own — the panel decides from the caller's role.
 *
 * The role is read here, on the server, and passed down: the decision is made
 * before a single element is serialised, so a member's document never carries
 * the Embedded Signup wizard and no client cache can put it back.
 */
export default async function WhatsAppPage() {
  const role = await fetchAccessRole();

  return (
    <div className="space-y-6">
      <PageHeader
        description="Connect your WhatsApp Business number in one step through Meta, or paste your own app's credentials. Nothing is stored until Meta confirms it."
        eyebrow={nav.group}
        title={nav.title}
      />

      <WhatsAppPanel role={role} />
    </div>
  );
}
