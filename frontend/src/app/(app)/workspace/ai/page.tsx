import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import { FileText, MessageSquare, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/workspace/page-header";
import { PlannedCapabilities } from "@/components/workspace/planned-capabilities";
import { getNavItem } from "@/config/workspace-nav";

const nav = getNavItem("/workspace/ai");

export const metadata: Metadata = { title: nav.title };

const PANELS: { title: string; description: string; icon: LucideIcon }[] = [
  {
    title: "Suggested replies",
    description:
      "Drafts a reply from the thread and your knowledge base so an agent can send it in one click.",
    icon: MessageSquare,
  },
  {
    title: "Conversation summaries",
    description:
      "Condenses a long thread into the outcome, the open question and what happens next.",
    icon: FileText,
  },
  {
    title: "Knowledge base",
    description:
      "The source of truth the assistant answers from: policies, prices, delivery windows and FAQs.",
    icon: Sparkles,
  },
];

export default function AiAssistantPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="OpenAI powers the assistant, and every call is metered against your plan so usage never surprises you."
        eyebrow={nav.group}
        title={nav.title}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {PANELS.map((panel) => (
          <section
            key={panel.title}
            className="flex flex-col rounded-xl border border-border bg-card p-5"
          >
            <span className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand">
              <panel.icon className="size-4" aria-hidden="true" />
            </span>
            <h2 className="mt-3.5 text-sm font-semibold text-foreground">
              {panel.title}
            </h2>
            <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">
              {panel.description}
            </p>
            <span className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden="true" />
              Not configured
            </span>
          </section>
        ))}
      </div>

      <PlannedCapabilities
        items={[
          "AI-powered customer support replies",
          "FAQ responses sourced from your knowledge base",
          "Lead qualification from the conversation",
          "Thread summaries for handover",
          "Suggested replies an agent can edit",
          "Multi-language responses",
          "Escalation to a human when confidence is low",
          "Usage tracked against your plan limits",
        ]}
      />
    </div>
  );
}
