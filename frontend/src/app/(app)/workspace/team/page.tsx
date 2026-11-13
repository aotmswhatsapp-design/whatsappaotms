import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/workspace/data-table";
import { EmptyState } from "@/components/workspace/empty-state";
import { PageHeader } from "@/components/workspace/page-header";
import { PlannedCapabilities } from "@/components/workspace/planned-capabilities";
import { getNavItem } from "@/config/workspace-nav";
import { getSessionUser } from "@/lib/auth/session";

const nav = getNavItem("/workspace/team");

export const metadata: Metadata = { title: nav.title };

const COLUMNS = [
  { key: "member", label: "Member" },
  { key: "email", label: "Email" },
  { key: "role", label: "Role" },
  { key: "status", label: "Status", className: "text-right" },
];

/**
 * The only row that exists today is the account itself, so this table renders
 * real data rather than an empty state.
 */
async function MembersTable() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <DataTable
      columns={COLUMNS}
      rows={[
        [
          <span key="name" className="font-medium text-foreground">
            {user.name ?? "Workspace owner"}
          </span>,
          <span key="email" className="text-muted-foreground">
            {user.email}
          </span>,
          <span
            key="role"
            className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand"
          >
            Owner
          </span>,
          <span key="status" className="text-xs text-muted-foreground">
            Active · you
          </span>,
        ],
      ]}
      empty={
        <EmptyState
          className="border-0 bg-transparent py-10"
          description="No members yet."
          icon={Users}
          title="This workspace has no team"
        />
      }
    />
  );
}

function MembersSkeleton() {
  return (
    <div
      className="h-32 animate-pulse rounded-xl border border-border bg-card"
      aria-hidden="true"
    />
  );
}

export default function TeamPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <Button disabled variant="brand">
            <Users />
            Invite a member
          </Button>
        }
        description="Roles decide who can send campaigns, who can only answer conversations, and who manages the workspace. Invitations arrive with the team module."
        eyebrow={nav.group}
        title={nav.title}
      />

      <Suspense fallback={<MembersSkeleton />}>
        <MembersTable />
      </Suspense>

      <PlannedCapabilities
        items={[
          "Invite members by email",
          "Business Owner, Manager and Support Agent roles",
          "Role-based permissions enforced on the backend",
          "Assign conversations to specific agents",
          "Remove access without deleting history",
          "Audit log of membership changes",
        ]}
      />
    </div>
  );
}
