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
 *
 * Being per tab is not enough on its own: the session cookie is shared, so a
 * sign-in or sign-out in another tab changes the person behind this one too.
 * The account is therefore re-checked whenever the tab is looked at, and the
 * cache is dropped outright when a tab announces that it changed hands.
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

/**
 * Where the other tabs read "the account changed". The value is a nonce, never
 * a role: the signal says only that a cached answer is no longer trustworthy,
 * and each tab then asks the API for its own.
 */
const SIGNAL_KEY = "aotms:workspace-role";

/** Set once the tab-level listeners are wired; they live as long as the tab. */
let started = false;

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
 * Forgets the answer in this tab only. Every mount calls it, and so does every
 * fetch that finds a different account behind the session — a cached OWNER
 * from the person who was here before must never be rendered to the person
 * here now.
 *
 * Silent on purpose: a route change in one tab is no news to the others, and
 * announcing it would make them drop a perfectly good answer on every
 * navigation.
 */
export function clearWorkspaceRole(): void {
  invalidate(false);
}

/**
 * Forgets the answer here and tells the other tabs to do the same.
 *
 * Sign-in and sign-out call this. The session cookie is shared by every tab, so
 * an account change in one of them makes the cached role wrong in all of them,
 * and a cookie change fires no event of its own.
 */
export function invalidateWorkspaceRole(): void {
  invalidate(true);
}

function invalidate(announce: boolean): void {
  ensureStarted();

  if (announce) announceChange();

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
  ensureStarted();

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
  const userId = await sessionUserId();

  // A role belongs to a person, not to a tab. If the session has changed hands
  // since the last answer, the cached value is somebody else's, so it is
  // dropped before it can be rendered. The generation is checked first: a read
  // a clear has already superseded must not stamp its account either, or the
  // read that replaced it would discard its own answer.
  if (startedAt === generation && userId !== answeredFor) {
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

/**
 * The session's account id, or null when there is no session. Imported lazily
 * so a page that never asks for a role does not pull the Supabase client into
 * its bundle — the same reason `http.ts` does it.
 */
async function sessionUserId(): Promise<string | null> {
  const { createClient } = await import("@/lib/supabase/client");
  const { data } = await createClient().auth.getSession();

  return data.session?.user.id ?? null;
}

/**
 * The three ways a cached role goes stale without this tab asking:
 *
 * - `onAuthStateChange` — a sign-in or sign-out this tab's own client observed,
 *   including a session that expired and could not be refreshed;
 * - `storage` — the signal another tab writes in `invalidateWorkspaceRole()`,
 *   since a shared cookie change fires no event of its own;
 * - `visibilitychange` / `focus` — the session is re-read when the tab is
 *   looked at, which catches a change made somewhere we did not control.
 *
 * A signal only ever drops the cache; it never fills it. The replacement answer
 * comes from a session read, so a tab can never adopt a role it did not verify.
 * The listeners belong to the tab rather than to a component, so they are
 * installed once and outlive every mount.
 */
function ensureStarted(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("storage", (event) => {
    if (event.key === SIGNAL_KEY) invalidate(false);
  });

  const wake = () => {
    if (document.visibilityState === "visible") void revalidate();
  };

  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);

  void import("@/lib/supabase/client")
    .then(({ createClient }) => {
      createClient().auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT") invalidate(false);
      });
    })
    .catch(() => {
      // Without the client there is nothing to observe here; the signal and the
      // focus check still cover the other two paths.
    });
}

/** Tells the other tabs that the account behind the shared cookie changed. */
function announceChange(): void {
  if (typeof window === "undefined") return;

  try {
    // A nonce, so two changes in the same millisecond still fire an event: the
    // browser only reports a storage write when the value actually differs.
    window.localStorage.setItem(SIGNAL_KEY, `${Date.now()}:${Math.random()}`);
  } catch {
    // Storage can be refused (private mode). This tab still cleared its own
    // answer, and the focus check catches the others.
  }
}

/**
 * Drops the cache when the session's account is not the one it answered for,
 * then asks again. Reading the session first keeps an unchanged account from
 * clearing the controls every time the tab is focused.
 */
async function revalidate(): Promise<void> {
  let userId: string | null;

  try {
    userId = await sessionUserId();
  } catch {
    // An unreadable session is not proof that the person changed; leaving the
    // answer alone beats flashing read-only on a transient failure.
    return;
  }

  // Same account and an answer is already on screen: nothing to do. A missing
  // answer — a read that failed — is worth another try.
  if (userId === answeredFor && lastKnown !== null) return;

  invalidate(false);

  if (userId !== null) void fetchWorkspaceRole().catch(() => {});
}
