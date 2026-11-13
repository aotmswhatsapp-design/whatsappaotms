import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { supabaseConfig } from "@/config/supabase";

/**
 * Server client for Server Components, Server Actions and Route Handlers.
 *
 * `cookies()` is async in Next 16. Writes are wrapped in try/catch because a
 * Server Component cannot set cookies — that throws, and the only thing it
 * would be doing is refreshing a session that `proxy.ts` already refreshed.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseConfig.url, supabaseConfig.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component; proxy.ts owns the refresh.
        }
      },
    },
  });
}
