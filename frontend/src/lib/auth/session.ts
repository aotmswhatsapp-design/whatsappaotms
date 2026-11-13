import { cache } from "react";
import { connection } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/auth/types";

/**
 * Resolves the signed-in user for the current request.
 *
 * `cache()` memoises per request, so a layout and every child that needs the
 * user pay for one auth round-trip, not one each. Calls `getUser()` rather than
 * `getSession()` so a tampered cookie cannot produce a user object.
 *
 * This reads cookies, so it must be rendered inside a `<Suspense>` boundary —
 * `cacheComponents` rejects dynamic data outside one.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // `@supabase/ssr` calls Date.now() while loading the session (cookie expiry),
  // which `cacheComponents` refuses to evaluate during prerendering. Waiting
  // for the request first moves everything below out of the static shell, so
  // the boundary streams instead of failing the build with
  // "encountered the unstable value `Date.now()`".
  await connection();

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  const metadata = user.user_metadata ?? {};

  return {
    id: user.id,
    email: user.email ?? "",
    name:
      (typeof metadata.full_name === "string" && metadata.full_name) ||
      (typeof metadata.name === "string" && metadata.name) ||
      null,
    avatarUrl:
      (typeof metadata.avatar_url === "string" && metadata.avatar_url) ||
      // Google stores the image under `picture`, not `avatar_url`.
      (typeof metadata.picture === "string" && metadata.picture) ||
      null,
  };
});
