import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, CreditCard, Receipt } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/workspace/data-table";
import { EmptyState } from "@/components/workspace/empty-state";
import { PageHeader } from "@/components/workspace/page-header";
import { PlannedCapabilities } from "@/components/workspace/planned-capabilities";
import { getNavItem } from "@/config/workspace-nav";

const nav = getNavItem("/workspace/billing");

export const metadata: Metadata = { title: nav.title };

const INVOICE_COLUMNS = [
  { key: "invoice", label: "Invoice" },
  { key: "date", label: "Date" },
  { key: "amount", label: "Amount", className: "text-right" },
  { key: "status", label: "Status", className: "text-right" },
];

const USAGE = [
  ["Team seats", "1"],
  ["Contacts", "—"],
  ["Messages this month", "—"],
  ["AI calls this month", "—"],
] as const;

export default function BillingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="Subscriptions are created by the backend only after Razorpay confirms a payment — a success redirect alone never grants access."
        eyebrow={nav.group}
        title={nav.title}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Current plan</h2>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden="true" />
              No plan attached
            </span>
          </div>

          <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
            <CreditCard className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              This account was provisioned manually, so there is no subscription
              record behind it yet. Choose a plan on the public pricing page to
              attach one.
            </span>
          </p>

          <Button asChild className="mt-4 w-full" variant="outline">
            <Link href="/pricing">
              View plans
              <ArrowUpRight />
            </Link>
          </Button>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Usage this month</h2>
          <dl className="mt-4 space-y-2 text-xs">
            {USAGE.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 border-b border-border/70 pb-2 last:border-0 last:pb-0"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium text-foreground tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Limits are enforced by the backend against the plan attached to this
            workspace, not by hiding buttons in the UI.
          </p>
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Invoices</h2>
        <DataTable
          columns={INVOICE_COLUMNS}
          empty={
            <EmptyState
              className="border-0 bg-transparent py-8"
              description="Invoices and GST receipts appear here after the first Razorpay payment clears."
              icon={Receipt}
              title="No invoices yet"
            />
          }
        />
      </section>

      <PlannedCapabilities
        items={[
          "Plan selection and Razorpay checkout",
          "Payment history and GST invoices",
          "Usage tracked against plan limits",
          "Upgrades and downgrades",
          "Renewal and expiry handling",
          "Grace period before access is restricted",
          "Cancellation without deleting your data",
        ]}
      />
    </div>
  );
}
