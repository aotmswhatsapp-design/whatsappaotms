import { createBrowserClient } from "@supabase/ssr";

import { supabaseConfig } from "@/config/supabase";

/**
 * Browser client. Safe to call repeatedly — `createBrowserClient` returns the
 * same instance for the same project, so cookie handling stays in sync across
 * components.
 */
export function createClient() {
  return createBrowserClient(supabaseConfig.url, supabaseConfig.publishableKey);
}
