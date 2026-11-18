import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardBoard } from "@/components/workspace/dashboard/dashboard-board";
import { PageHeader } from "@/components/workspace/page-header";
import { ConnectCta } from "@/features/whatsapp/components/connect-cta";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Overview" };

/**
 * The single dashboard: identity from the session, then one draggable grid of
 * WhatsApp telemetry (see `DashboardBoard`). Every reading on the grid is
 * marked Preview until a Business number is connected.
 */
async function Overview() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const firstName =
    user.name?.trim().split(/\s+/)[0] || user.email.split("@")[0] || "there";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title={`Welcome, ${firstName}`}
        description={`You are signed in as ${user.email}. This dashboard tracks the WhatsApp channel — delivery, conversations, templates and opt-outs in one place.`}
        actions={<ConnectCta />}
      />

      <DashboardBoard />
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="space-y-3 border-b border-border pb-6">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="h-28 animate-pulse rounded-xl border border-border bg-card" />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-xl border border-border bg-card" />
        <div className="h-72 animate-pulse rounded-xl border border-border bg-card" />
      </div>
    </div>
  );
}

export default function WorkspaceOverviewPage() {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <Overview />
    </Suspense>
  );
}
