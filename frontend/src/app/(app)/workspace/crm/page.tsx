import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/workspace/page-header";
import { CrmView } from "@/features/crm/components/crm-view";
import { getNavItem } from "@/config/workspace-nav";
import { getSessionUser } from "@/lib/auth/session";

const nav = getNavItem("/workspace/crm");

export const metadata: Metadata = { title: nav.title };

/**
 * The leads are read by the client, because the request needs the browser's
 * session token; the page only has to know that someone is signed in.
 */
async function Leads() {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/workspace/crm")}`);

  return <CrmView />;
}

function LeadsSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-56 animate-pulse rounded-xl border border-border bg-card"
    />
  );
}

export default function LeadsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="The conversations that showed interest, the follow-ups they owe and who receives the next one. The inbox is where you answer; this is where you decide who does."
        eyebrow={nav.group}
        title={nav.title}
      />

      <Suspense fallback={<LeadsSkeleton />}>
        <Leads />
      </Suspense>
    </div>
  );
}
