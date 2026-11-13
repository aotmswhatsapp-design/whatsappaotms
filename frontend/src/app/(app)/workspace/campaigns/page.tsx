import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone, PlugZap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/workspace/data-table";
import { EmptyState } from "@/components/workspace/empty-state";
import { PageHeader } from "@/components/workspace/page-header";
import { PlannedCapabilities } from "@/components/workspace/planned-capabilities";
import { getNavItem } from "@/config/workspace-nav";

const nav = getNavItem("/workspace/campaigns");

export const metadata: Metadata = { title: nav.title };

const COLUMNS = [
  { key: "name", label: "Campaign" },
  { key: "template", label: "Template" },
  { key: "audience", label: "Audience" },
  { key: "status", label: "Status" },
  { key: "sent", label: "Sent", className: "text-right" },
  { key: "read", label: "Read", className: "text-right" },
];

export default function CampaignsPage() {
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
        description="A campaign is an approved template sent to a segment. Sending needs a connected number and at least one approved template."
        eyebrow={nav.group}
        title={nav.title}
      />

      <DataTable
        columns={COLUMNS}
        empty={
          <EmptyState
            className="border-0 bg-transparent py-10"
            description="Campaigns are queued through Redis and delivered by the worker fleet, then report delivery and read counts as the webhooks come back."
            icon={Megaphone}
            title="No campaigns yet"
          />
        }
      />

      <PlannedCapabilities
        items={[
          "Create a campaign and pick a segment",
          "Choose an approved template and map variables",
          "Preview and send a test message",
          "Schedule, pause and resume a send",
          "Queue delivery through BullMQ workers",
          "Track delivered, read and failed counts",
          "Campaign history you can revisit",
          "Export the campaign report",
        ]}
      />
    </div>
  );
}
