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
 * server would refuse. Every mount therefore asks again rather than trusting
 * what this tab answered for the last screen — the cache exists to share one
 * request between consumers, not to survive a sign-out.
 *
 * The role is read from the store rather than copied into state. A copy
 * outlives the answer it came from: a preserved route keeps its state across a
 * navigation, so the copy would keep rendering an owner's controls while the
 * cache is empty — and for good if the refetch failed. Reading the store makes
 * that impossible: clearing it, for any reason, renders `null` straight away.
 */
export function useWorkspaceRole(): WorkspaceRole | null {
  const pathname = usePathname();

  const role = React.useSyncExternalStore(
    subscribeWorkspaceRole,
    readWorkspaceRole,
    // The server has no session to ask about, and the client renders this same
    // value until the first answer arrives, so hydration has nothing to correct.
    () => null,
  );

  React.useEffect(() => {
    // Whatever is cached may describe the account this tab served before a
    // sign-out, or a workspace the caller has since left. Drop it before the
    // screen can show it, then ask again. A failed read leaves the role
    // unknown — which is the read-only answer — and the next route change asks
    // again.
    clearWorkspaceRole();

    void fetchWorkspaceRole().catch(() => {});
  }, [pathname]);

  return role;
}
