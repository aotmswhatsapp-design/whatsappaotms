import { request } from "./http";

/**
 * The three roles the schema stores. `ADMIN` is the Business Owner's Manager
 * and `AGENT` is the Support Agent.
 *
 * Declared here rather than imported from `features/team/api` because a shared
 * module must not depend on a feature (and a feature must not depend on
 * another feature either). The team screen's `TeamRole` is the same three
 * strings; it should be pointed at this one the next time that file is
 * touched.
 */
export type WorkspaceRole = "OWNER" | "ADMIN" | "AGENT";

/**
 * The caller's role in the workspace the API acts in, cached for the tab.
 *
 * `GET /v1/workspaces` is the only endpoint that answers this, and it is the
 * right one: it carries no `@Roles`, so every member may read it, and it
 * resolves the membership through the same lookup `WorkspaceRolesGuard` uses —
 * the role shown here and the role the agent routes enforce cannot disagree.
 *
 * The cache is deliberately timid. It records which account it answered for,
 * and an answer for a different account is discarded rather than shown: a
 * mutation control that flashes for the previous person is worse than one that
 * appears a moment late. `null` always means "unknown", never "probably an
 * owner", and the server remains the authority for every mutation.
 */
let lastKnown: WorkspaceRole | null = null;

/** The account id `lastKnown` belongs to; null until a fetch has said. */
let answeredFor: string | null = null;

/**
 * Bumped by every clear. A read that started before the clear belongs to the
 * account that asked for it, so it is not allowed to write after the fact.
 */
let generation = 0;

const listeners = new Set<() => void>();
let inFlight: Promise<WorkspaceRole> | null = null;

/** The client snapshot: `null` until this tab has an answer for this account. */
export function readWorkspaceRole(): WorkspaceRole | null {
  return lastKnown;
}

export function subscribeWorkspaceRole(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Forgets the answer. Sign-out calls this, and so does every fetch that finds a
 * different account behind the session — a cached OWNER from the person who
 * was here before must never be rendered to the person here now.
 */
export function clearWorkspaceRole(): void {
  generation += 1;
  answeredFor = null;
  // A read already on its way cannot be reused either: the next caller asks
  // again rather than inheriting the previous account's request.
  inFlight = null;

  if (lastKnown === null) return;

  lastKnown = null;
  notify();
}

export function fetchWorkspaceRole(): Promise<WorkspaceRole> {
  // Two consumers mounting on the same navigation must cost one request.
  if (inFlight) return inFlight;

  const pending = load().finally(() => {
    // Only the request that is still the current one clears the slot: a clear
    // during flight may already have started a newer read.
    if (inFlight === pending) inFlight = null;
  });

  inFlight = pending;
  return pending;
}

function notify(): void {
  for (const listener of listeners) listener();
}

async function load(): Promise<WorkspaceRole> {
  const startedAt = generation;

  // Imported lazily so a page that never asks for a role does not pull the
  // Supabase client into its bundle — the same reason `http.ts` does it.
  const { createClient } = await import("@/lib/supabase/client");
  const { data } = await createClient().auth.getSession();
  const userId = data.session?.user.id ?? null;

  // A role belongs to a person, not to a tab. If the session has changed hands
  // since the last answer, the cached value is somebody else's, so it is
  // dropped before it can be rendered.
  if (userId !== answeredFor) {
    answeredFor = userId;

    if (lastKnown !== null) {
      lastKnown = null;
      notify();
    }
  }

  const { role } = await request<{ role: WorkspaceRole }>("/v1/workspaces", {
    method: "GET",
  });

  // The session may have moved on, or a sign-out may have cleared the cache
  // while the request was out; the answer is only stored while it is still the
  // question that was asked.
  if (startedAt === generation && userId === answeredFor) {
    lastKnown = role;
    notify();
  }

  return role;
}
