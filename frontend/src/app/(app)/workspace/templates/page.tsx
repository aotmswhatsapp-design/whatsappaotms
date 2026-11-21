import type { Metadata } from "next";

import { PageHeader } from "@/components/workspace/page-header";
import { getNavItem } from "@/config/workspace-nav";
import { NewTemplateAction } from "@/features/templates/components/new-template-action";
import { TemplatesView } from "@/features/templates/components/templates-view";

const nav = getNavItem("/workspace/templates");

export const metadata: Metadata = { title: nav.title };

/**
 * Thin server shell, like the QR codes screen: the list is Meta's, reading it
 * needs the browser's session token, and it changes on Meta's schedule.
 */
export default function TemplatesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        actions={<NewTemplateAction />}
        description="Meta reviews every template before it can be sent. This list is your Business account's own — templates made in WhatsApp Manager appear here too, with their review status."
        eyebrow={nav.group}
        title={nav.title}
      />

      <TemplatesView />
    </div>
  );
}
