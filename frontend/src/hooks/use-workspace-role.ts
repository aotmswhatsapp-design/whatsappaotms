"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import {
  clearWorkspaceRole,
  fetchWorkspaceRole,
  readWorkspaceRole,
  subscribeWorkspaceRole,
  type WorkspaceRole,
} from "@/lib/api/workspace";

/**
 * The caller's role in the workspace the API acts in, or `null` while that is
 * unknown.
 *
 * `null` is not a placeholder for "probably an owner": consumers treat it as
 * "no mutation controls", so an unknown role can never reveal a control the
 * server would refuse. Every mount therefore starts from null and asks again
 * rather than trusting what this tab answered for the last screen — the cache
 * exists to share one request between consumers, not to survive a sign-out.
 */
export function useWorkspaceRole(): WorkspaceRole | null {
  const pathname = usePathname();
  const [role, setRole] = React.useState<WorkspaceRole | null>(null);

  React.useEffect(() => {
    // Whatever is cached may describe the account this tab served before a
    // sign-out, or a workspace the caller has since left. Drop it before any
    // consumer can read it, then ask again. A failed read leaves the role
    // unknown — which is the read-only answer — and the next route change asks
    // again.
    clearWorkspaceRole();

    const unsubscribe = subscribeWorkspaceRole(() => setRole(readWorkspaceRole()));

    void fetchWorkspaceRole().catch(() => {});

    return unsubscribe;
  }, [pathname]);

  return role;
}
