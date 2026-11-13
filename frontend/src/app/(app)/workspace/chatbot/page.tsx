import type { Metadata } from "next";
import { Bot, Zap } from "lucide-react";

import { EmptyState } from "@/components/workspace/empty-state";
import { PageHeader } from "@/components/workspace/page-header";
import { PlannedCapabilities } from "@/components/workspace/planned-capabilities";
import { getNavItem } from "@/config/workspace-nav";

const nav = getNavItem("/workspace/chatbot");

export const metadata: Metadata = { title: nav.title };

const RULE_TYPES = [
  "Welcome message on first contact",
  "Keyword triggers and automated replies",
  "Interactive buttons and list messages",
  "Conditional branches with a fallback",
  "Human handoff to the shared inbox",
];

export default function ChatbotPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="Answer the routine questions before an agent picks up. Flows run inside the backend, so there is no third-party automation tool in the path."
        eyebrow={nav.group}
        title={nav.title}
      />

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Flows</h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              0
            </span>
          </div>
          <EmptyState
            className="mt-4 border-0 bg-secondary/50 py-10"
            description="A flow starts with a welcome message and a handful of keyword triggers. Nothing can be created until a number is connected."
            icon={Bot}
            title="No chatbot flows yet"
          />
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Rule types</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            What a single flow can contain.
          </p>
          <ul className="mt-4 space-y-3">
            {RULE_TYPES.map((rule) => (
              <li key={rule} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <Zap className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
                <span className="leading-relaxed">{rule}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <PlannedCapabilities
        items={[
          "Welcome messages per entry point",
          "Keyword-based triggers",
          "Automated replies with variables",
          "Interactive buttons and list messages",
          "Conditional responses per branch",
          "FAQ automation from a knowledge base",
          "Fallback message when nothing matches",
          "Hand the conversation to a human",
          "All execution runs in the NestJS backend",
        ]}
      />
    </div>
  );
}
