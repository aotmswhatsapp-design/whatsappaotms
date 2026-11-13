import type { Metadata } from "next";
import { BarChart3, Inbox, MessageSquare, Send } from "lucide-react";

import { PageHeader } from "@/components/workspace/page-header";
import { PlannedCapabilities } from "@/components/workspace/planned-capabilities";
import { StatCard } from "@/components/workspace/stat-card";
import { getNavItem } from "@/config/workspace-nav";

const nav = getNavItem("/workspace/analytics");

export const metadata: Metadata = { title: nav.title };

const RANGES = ["Today", "Last 7 days", "Last 30 days", "Custom"];

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="Every figure below comes from your own database. Nothing is aggregated across customers, and nothing is sampled."
        eyebrow={nav.group}
        title={nav.title}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {RANGES.map((range, index) => (
          <span
            key={range}
            className={
              index === 1
                ? "rounded-lg border border-brand/30 bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand"
                : "rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"
            }
          >
            {range}
          </span>
        ))}
        <span className="ml-1 text-xs text-muted-foreground">
          Ranges activate with the reporting module.
        </span>
      </div>

      <section aria-label="Delivery funnel" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sent" value="—" hint="No sends yet" icon={Send} />
        <StatCard label="Delivered" value="—" hint="Awaiting webhooks" icon={Inbox} accent="blue" />
        <StatCard label="Read" value="—" hint="Awaiting webhooks" icon={MessageSquare} accent="lime" />
        <StatCard label="Failed" value="—" hint="Nothing to report" icon={BarChart3} accent="muted" />
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Volume over time</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Daily sends, deliveries and reads.
            </p>
          </div>
          <span className="text-[11px] font-medium text-muted-foreground">
            No data
          </span>
        </div>
        <div className="mt-4 flex h-48 items-end justify-center rounded-lg border border-dashed border-border bg-secondary/40">
          <p className="pb-4 text-center text-sm text-muted-foreground">
            The chart fills in after your first campaign.
          </p>
        </div>
      </section>

      <PlannedCapabilities
        items={[
          "Messages sent, delivered, read and failed",
          "Incoming message volume",
          "Campaign performance per send",
          "Contact growth over time",
          "Chatbot resolution rate",
          "Agent response and resolution times",
          "Automation execution status",
          "Daily, weekly, monthly and campaign reports",
        ]}
      />
    </div>
  );
}
