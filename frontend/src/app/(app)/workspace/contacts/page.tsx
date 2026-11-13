import type { Metadata } from "next";
import Link from "next/link";
import { Contact, PlugZap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/workspace/data-table";
import { EmptyState } from "@/components/workspace/empty-state";
import { PageHeader } from "@/components/workspace/page-header";
import { PlannedCapabilities } from "@/components/workspace/planned-capabilities";
import { getNavItem } from "@/config/workspace-nav";

const nav = getNavItem("/workspace/contacts");

export const metadata: Metadata = { title: nav.title };

const COLUMNS = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "tags", label: "Tags" },
  { key: "consent", label: "Consent" },
  { key: "added", label: "Added", className: "text-right" },
];

export default function ContactsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <Button asChild variant="brand">
            <Link href="/workspace/whatsapp">
              <PlugZap />
              Connect WhatsApp first
            </Link>
          </Button>
        }
        description="Your audience lives in your own database. Import a list once WhatsApp is connected, then segment it for campaigns."
        eyebrow={nav.group}
        title={nav.title}
      />

      <DataTable
        columns={COLUMNS}
        empty={
          <EmptyState
            className="border-0 bg-transparent py-10"
            description="Contacts arrive by CSV or Excel import, by the WhatsApp inbox, or one at a time. None of those paths exist until a number is connected."
            icon={Contact}
            title="No contacts yet"
          />
        }
      />

      <PlannedCapabilities
        items={[
          "Add, edit and delete contacts",
          "Import CSV and Excel files",
          "Export the full contact list",
          "Contact groups and tags",
          "Custom fields per workspace",
          "Consent and opt-out tracking",
          "Search and filter across the list",
          "Every record stays in your own database",
        ]}
      />
    </div>
  );
}
