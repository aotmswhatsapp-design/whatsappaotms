"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

import { MODULE_LABELS, type ModuleKey } from "@/config/modules";
import { fetchAccess, type AccessRole, type AccessView } from "@/lib/access/api";

interface AccessState {
  /** Null until the first answer arrives (or when it never does). */
  access: AccessView | null;
  /** The API refused or was unreachable; the shell stays usable but open. */
  failed: boolean;
  reload: () => void;
}

const AccessContext = createContext<AccessState | null>(null);

/**
 * Reads the caller's role and modules once per signed-in shell.
 *
 * This is presentation, not security: the API refuses a disabled module with
 * 403 on its own. What it buys is that a hidden module is never mounted, so
 * its screens do not fire a request that is destined to fail.
 */
export function AccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<AccessView | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let live = true;

    fetchAccess()
      .then((view) => {
        if (!live) return;
        setAccess(view);
        setFailed(false);
      })
      .catch(() => {
        // A 401 belongs to the auth layer's own redirect; anything else shows
        // the nav unfiltered rather than an empty workspace. The page gate
        // still refuses what the API refuses.
        if (live) setFailed(true);
      });

    return () => {
      live = false;
    };
  }, [attempt]);

  const value = useMemo(
    () => ({ access, failed, reload }),
    [access, failed, reload],
  );

  return (
    <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
  );
}

function useAccessState(): AccessState {
  const state = useContext(AccessContext);

  if (!state) {
    throw new Error("useAccess must be read inside <AccessProvider>");
  }

  return state;
}

/** The caller's role and modules, for screens that branch on them. */
export function useAccess(): {
  role: AccessRole | null;
  modules: ModuleKey[] | null;
  /**
   * Null until the access read answers: a control must not claim the number
   * is missing while the answer is still in flight.
   */
  hasPersonalWhatsApp: boolean | null;
  failed: boolean;
} {
  const { access, failed } = useAccessState();

  return {
    role: access?.role ?? null,
    modules: access?.modules ?? null,
    hasPersonalWhatsApp: access ? access.hasPersonalWhatsApp : null,
    failed,
  };
}

/**
 * Whether the current role may open a module.
 *
 * `true` while the answer is in flight: a page that paints for a moment and
 * then disappears is worse than one that lingers, and the API is the real
 * gate either way.
 */
export function useModule(key: ModuleKey): boolean {
  const { modules } = useAccess();

  return modules === null || modules.includes(key);
}

/**
 * The refusal a member sees when a module the owner switched off is opened by
 * URL. It names the module and says who can switch it back on, never claiming
 * the page is missing when it exists.
 */
export function ModuleUnavailable({ module }: { module: ModuleKey }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-border bg-card p-8 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-secondary text-muted-foreground">
        <Lock className="size-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-foreground">
        {MODULE_LABELS[module]} is not enabled for your role
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        The workspace owner decides which modules each role can open. Ask them
        to switch {MODULE_LABELS[module]} on under Team &amp; permissions.
      </p>
      <Link
        href="/workspace"
        className="mt-5 inline-flex items-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand/90 focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        Back to overview
      </Link>
    </div>
  );
}
