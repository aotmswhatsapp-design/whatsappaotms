import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Link2Off } from "lucide-react";

import { PageHeader } from "@/components/workspace/page-header";
import { JoinView } from "@/features/team/components/join-view";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Join a team" };

type Search = { token?: string | string[] };

function tokenOf(params: Search): string {
  const raw = params.token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  return token?.trim() ?? "";
}

/**
 * The landing page for an invitation link.
 *
 * The token is the whole proof, so it stays in the URL and is posted verbatim.
 * A signed-out visitor is sent to the login page first and comes back here with
 * the token intact — the invitation is matched against the address they sign in
 * with, which is what stops a forwarded link adding the wrong person.
 */
async function Join({ searchParams }: { searchParams: Promise<Search> }) {
  const token = tokenOf(await searchParams);

  if (!token) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
            <Link2Off aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">
              This link has no invitation code
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Open the link exactly as it was passed on, or ask the workspace
              owner for a new one. Invitations are created in the Team screen.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const user = await getSessionUser();

  if (!user) {
    const target = `/workspace/join?token=${encodeURIComponent(token)}`;
    redirect(`/login?next=${encodeURIComponent(target)}`);
  }

  return <JoinView token={token} signedInAs={user.email} />;
}

function JoinSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-40 animate-pulse rounded-xl border border-border bg-card"
    />
  );
}

export default function JoinPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        description="An invitation adds this account to the workspace that sent it. Your address has to be the one it was sent to."
        eyebrow="Team"
        title="Join a team"
      />

      <Suspense fallback={<JoinSkeleton />}>
        <Join searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
