import type { Metadata } from "next";

import { SectionPlaceholder } from "@/components/marketing/section-placeholder";

export const metadata: Metadata = { title: "Features" };

export default function FeaturesPage() {
  return (
    <SectionPlaceholder
      eyebrow="Features"
      title="Everything your WhatsApp channel needs, in one workspace"
      description="Campaigns, a shared inbox, chatbots, and reporting — all running on the official WhatsApp Business Cloud API."
      items={[
        "Approved template campaigns with dynamic variables",
        "Shared inbox with agent assignment and internal notes",
        "Keyword and button chatbots with human handoff",
        "Consent tracking and opt-out enforcement",
        "Delivery, read, and failure analytics per campaign",
        "Separate database per customer, isolated by design",
      ]}
    />
  );
}
