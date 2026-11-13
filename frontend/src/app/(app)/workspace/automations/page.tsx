import type { Metadata } from "next";
import { Workflow } from "lucide-react";

import { DataTable } from "@/components/workspace/data-table";
import { EmptyState } from "@/components/workspace/empty-state";
import { PageHeader } from "@/components/workspace/page-header";
import { PlannedCapabilities } from "@/components/workspace/planned-capabilities";
import { getNavItem } from "@/config/workspace-nav";

const nav = getNavItem("/workspace/automations");

export const metadata: Metadata = { title: nav.title };

const COLUMNS = [
  { key: "name", label: "Rule" },
  { key: "trigger", label: "Trigger" },
  { key: "action", label: "Action" },
  { key: "runs", label: "Runs", className: "text-right" },
  { key: "status", label: "Status", className: "text-right" },
];

export default function AutomationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="Event and schedule based rules that run in-house, not in an external workflow tool. Every job carries your workspace context."
        eyebrow={nav.group}
        title={nav.title}
      />

      <DataTable
        columns={COLUMNS}
        empty={
          <EmptyState
            className="border-0 bg-transparent py-10"
            description="A rule pairs a trigger with an action and a retry policy. Rules appear here once the automation engine and its queue are running."
            icon={Workflow}
            title="No automation rules yet"
          />
        }
      />

      <PlannedCapabilities
        items={[
          "Event-based triggers",
          "Scheduled jobs and timed follow-ups",
          "Conditional rules with branches",
          "Lead notifications to your team",
          "Appointment and order reminders",
          "Retry handling with backoff",
          "Execution logs per run",
          "Job cancellation before dispatch",
          "Per-workspace rate limiting",
        ]}
      />
    </div>
  );
}
