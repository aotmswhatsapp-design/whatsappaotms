import { connection } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { AccessRole } from "@/lib/access/api";

import { BASE_URL } from "./http";

const ROLES: readonly AccessRole[] = ["OWNER", "ADMIN", "MANAGER", "AGENT"];

/**
 * The caller's role, read on the server so a screen can decide before any
 * client state exists.
 *
 * The WhatsApp connection belongs to the owner, and a role held in a client
 * cache can lag a sign-in or a tab that changed hands. Asking here puts the
 * answer into the markup itself: a member's page never contains the connect
 * wizard, so there is no moment where it is mounted and then withdrawn.
 *
 * `null` means the question could not be asked — no session, an unreachable
 * API — and callers must read it as "not confirmed as the owner", never as an
 * owner who is allowed through.
 */
export async function fetchAccessRole(): Promise<AccessRole | null> {
  // Cookies are read below, which `cacheComponents` only allows inside a
  // Suspense boundary — the same reason `getSessionUser` waits for the request.
  await connection();

  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) return null;

  try {
    const response = await fetch(`${BASE_URL}/v1/workspaces/access`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!response.ok) return null;

    const view = (await response.json()) as { role?: unknown };

    return ROLES.find((role) => role === view.role) ?? null;
  } catch {
    // A down API is not a role. The screen falls back to the read-only card,
    // which is the safe answer for everyone who is not confirmed as the owner.
    return null;
  }
}
