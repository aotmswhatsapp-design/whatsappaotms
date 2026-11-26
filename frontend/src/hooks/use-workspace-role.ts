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
 * What the caller's role is, how far the read has got, and how to ask again.
 *
 * `status` exists because "read-only" has three causes a person cannot tell
 * apart on screen: the role is still loading, the read failed, or the caller is
 * genuinely not the owner. Only the last one is a fact; showing the owner-only
 * sentence for the first two is how a working form looks broken.
 */
export interface RoleState {
  role: WorkspaceRole | null;
  status: "loading" | "ready" | "failed";
  /** Asks again. A failed read is a click away from working, not a reload. */
  retry: () => void;
}

/**
 * The caller's role in the workspace the API acts in, `null` while that is
 * unknown, and whether the unknown is "still asking" or "the ask failed".
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
export function useWorkspaceRole(): RoleState {
  const pathname = usePathname();
  const [attempt, setAttempt] = React.useState(0);

  /** Bumped when the store loses its answer behind this hook's back. */
  const [cleared, setCleared] = React.useState(0);

  /**
   * The last answer that arrived, tagged with the request it answered. A stale
   * one — a navigation or a retry moved on — is ignored by the tag rather than
   * reset by an effect, which is also what keeps this effect from setting state
   * on every run.
   */
  const [answer, setAnswer] = React.useState<{
    attempt: number;
    pathname: string;
    failed: boolean;
  } | null>(null);

  const role = React.useSyncExternalStore(
    subscribeWorkspaceRole,
    readWorkspaceRole,
    // The server has no session to ask about, and the client renders this same
    // value until the first answer arrives, so hydration has nothing to correct.
    () => null,
  );

  /**
   * The store can lose its answer without this hook asking: another tab signs
   * out, Supabase reports a session change, or a focus revalidation clears the
   * cache and its own request then fails. None of those touch `attempt` or
   * `pathname`, so the effect below would never run again — every owner-only
   * control would stay disabled in "Checking your permissions…" until a
   * reload, which is exactly how switching tabs used to freeze a screen.
   * Coming back to the tab asks once more.
   */
  const hadAnswer = React.useRef(false);

  React.useEffect(() => {
    hadAnswer.current = answer !== null;
  }, [answer]);

  React.useEffect(() => {
    const wake = () => {
      if (document.visibilityState !== "visible") return;

      // Only a lost answer is news. A first load is already in flight, and
      // asking twice would clear the request it is waiting on.
      if (hadAnswer.current && readWorkspaceRole() === null) {
        setCleared((count) => count + 1);
      }
    };

    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);

    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, []);

  React.useEffect(() => {
    // Whatever is cached may describe the account this tab served before a
    // sign-out, or a workspace the caller has since left. Drop it before the
    // screen can show it, then ask again. A failed read leaves the role
    // unknown — which is the read-only answer — and the next route change asks
    // again.
    clearWorkspaceRole();

    void fetchWorkspaceRole().then(
      // A resolved request is not an answer: a clear that raced it discards the
      // role, and the store is the only place that knows.
      () => setAnswer({ attempt, pathname, failed: readWorkspaceRole() === null }),
      () => setAnswer({ attempt, pathname, failed: true }),
    );
  }, [pathname, attempt, cleared]);

  // Read together, never separately: a focus revalidation clears the store, and
  // a stale "ready" beside a null role would render the owner's controls to
  // somebody whose role is no longer known.
  const status: RoleState["status"] =
    role !== null
      ? "ready"
      : answer !== null &&
          answer.attempt === attempt &&
          answer.pathname === pathname &&
          answer.failed
        ? "failed"
        : "loading";

  /**
   * A failed read gets one more try by itself: the usual cause is a token
   * refresh racing the request, which a moment later succeeds. The attempt is
   * counted so a real outage cannot become a loop, and when it stays failed the
   * screen offers Retry instead of spinning in "Checking…" forever.
   */
  const autoRetried = React.useRef(false);

  React.useEffect(() => {
    if (status !== "failed") {
      autoRetried.current = false;
      return;
    }

    if (autoRetried.current) return;

    autoRetried.current = true;
    const timer = window.setTimeout(() => setCleared((count) => count + 1), 1_500);

    return () => window.clearTimeout(timer);
  }, [status]);

  const retry = React.useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);

  return { role, status, retry };
}
