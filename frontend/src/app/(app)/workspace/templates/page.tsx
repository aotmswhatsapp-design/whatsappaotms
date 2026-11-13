import type { Metadata } from "next";
import { FileText } from "lucide-react";

import { DataTable } from "@/components/workspace/data-table";
import { EmptyState } from "@/components/workspace/empty-state";
import { PageHeader } from "@/components/workspace/page-header";
import { PlannedCapabilities } from "@/components/workspace/planned-capabilities";
import { getNavItem } from "@/config/workspace-nav";

const nav = getNavItem("/workspace/templates");

export const metadata: Metadata = { title: nav.title };

const COLUMNS = [
  { key: "name", label: "Template" },
  { key: "category", label: "Category" },
  { key: "language", label: "Language" },
  { key: "status", label: "Meta status" },
  { key: "updated", label: "Updated", className: "text-right" },
];

export default function TemplatesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="Meta reviews every template before it can be sent. Approval can take minutes or hours, and the list below syncs straight from your Business account."
        eyebrow={nav.group}
        title={nav.title}
      />

      <DataTable
        columns={COLUMNS}
        empty={
          <EmptyState
            className="border-0 bg-transparent py-10"
            description="Once a WhatsApp Business account is connected, its approved templates are synchronised here with their category, language and review status."
            icon={FileText}
            title="No templates synced"
          />
        }
      />

      <PlannedCapabilities
        items={[
          "Sync templates from the connected account",
          "Category, language and review status per template",
          "Dynamic variables mapped per campaign",
          "Body, header, footer and button preview",
          "Fallback copy for rejected templates",
          "Only approved templates can be sent",
        ]}
      />
    </div>
  );
}
