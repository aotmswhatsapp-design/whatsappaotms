import type { Metadata } from "next";
import { Inbox } from "lucide-react";

import { EmptyState } from "@/components/workspace/empty-state";
import { PageHeader } from "@/components/workspace/page-header";
import { PlannedCapabilities } from "@/components/workspace/planned-capabilities";
import { getNavItem } from "@/config/workspace-nav";

const nav = getNavItem("/workspace/inbox");

export const metadata: Metadata = { title: nav.title };

export default function InboxPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={nav.group}
        title={nav.title}
        description="Incoming WhatsApp messages land here in real time. Nothing is connected yet, so the queue is empty."
      />

      <div className="grid overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="border-b border-border lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              Conversations
            </p>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              0
            </span>
          </div>
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No conversations yet.
          </p>
        </div>

        <div className="p-4">
          <EmptyState
            className="border-0 bg-transparent py-16"
            description="Once a customer messages your number, the thread opens here with assignment, status and internal notes."
            icon={Inbox}
            title="Nothing to answer"
          />
        </div>
      </div>

      <PlannedCapabilities
        items={[
          "Unified inbox across every connected number",
          "Incoming and outgoing message history",
          "Image and document attachments",
          "Assign a conversation to an agent",
          "Internal notes hidden from the customer",
          "Conversation status: open, pending, closed",
          "Search and filter by contact or agent",
          "Real-time updates as replies arrive",
        ]}
      />
    </div>
  );
}
