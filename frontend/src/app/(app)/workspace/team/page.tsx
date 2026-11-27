import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/workspace/page-header";
import { TeamView } from "@/features/team/components/team-view";
import { getNavItem } from "@/config/workspace-nav";
import { getSessionUser } from "@/lib/auth/session";

const nav = getNavItem("/workspace/team");

export const metadata: Metadata = { title: nav.title };

/**
 * The viewer's id is known server-side and worth passing down: it marks "you"
 * in the list and is the one row an owner cannot remove. The team itself is
 * read by the client, because the request needs the browser's session token.
 */
async function Team() {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/workspace/team")}`);

  return <TeamView viewerId={user.id} />;
}

function TeamSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-56 animate-pulse rounded-xl border border-border bg-card"
    />
  );
}

export default function TeamPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="Roles decide who sends campaigns, who answers the inbox and who manages the workspace. Only the owner invites people and changes roles — and with no mailer in this deployment, an invitation is a link you pass on yourself. Each person also gets a designation and their own WhatsApp number, so interested leads rotate to the right desk and follow-ups go out from the right phone."
        eyebrow={nav.group}
        title={nav.title}
      />

      <Suspense fallback={<TeamSkeleton />}>
        <Team />
      </Suspense>
    </div>
  );
}
