import type { Metadata } from "next";

import { PageHeader } from "@/components/workspace/page-header";
import { getNavItem } from "@/config/workspace-nav";
import { QrCodesView } from "@/features/whatsapp/components/qr-codes-view";

const nav = getNavItem("/workspace/qr-codes");

export const metadata: Metadata = { title: nav.title };

/**
 * Thin server shell: every fact on this screen lives in Meta, and reading it
 * needs the browser's session token, so the view fetches for itself.
 */
export default function QrCodesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="A code on a counter or a link in a bio opens a chat with your number, already holding a message the customer can send in one tap."
        eyebrow={nav.group}
        title={nav.title}
      />

      <QrCodesView />
    </div>
  );
}
