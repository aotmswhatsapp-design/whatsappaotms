import type { Metadata } from "next";

import { SectionPlaceholder } from "@/components/marketing/section-placeholder";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <SectionPlaceholder
      eyebrow="Contact"
      title="Talk to us about your WhatsApp setup"
      description="Questions about plans, migration, or whether your use case is a good fit — send a message and we will reply within one business day."
      items={[
        "Sales and plan questions",
        "Technical onboarding and Meta verification help",
        "Migration from another WhatsApp tool",
        "Enterprise volume and custom limits",
      ]}
    />
  );
}
