import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { supabaseConfig } from "@/config/supabase";

/** Routes that require a session. Everything else is public. */
const PROTECTED_PREFIXES = ["/workspace"] as const;

/**
 * Routes that only make sense signed out. /reset-password is absent on purpose:
 * it needs the temporary recovery session to write the new password.
 */
const SIGNED_OUT_ONLY = ["/login", "/signup", "/forgot-password"] as const;

function matches(pathname: string, prefixes: readonly string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function redirectWithCookies(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
  search?: Record<string, string>,
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  for (const [key, value] of Object.entries(search ?? {})) {
    url.searchParams.set(key, value);
  }

  const redirect = NextResponse.redirect(url);
  // Carry the refreshed session cookies onto the redirect, otherwise the
  // browser drops them and the user bounces between login and workspace.
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

/**
 * Refreshes the Supabase session on every matched request and enforces the
 * route guard. Tokens are rotated on a schedule, so a page that only reads
 * cookies can hold a stale access token; this is the one place allowed to
 * write them.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseConfig.url,
    supabaseConfig.publishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Must be `getUser()` rather than `getSession()`: only getUser round-trips to
  // the auth server, so a forged or expired token cannot pass the guard.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (matches(pathname, PROTECTED_PREFIXES) && !user) {
    return redirectWithCookies(request, response, "/login", { next: pathname });
  }

  if (matches(pathname, SIGNED_OUT_ONLY) && user) {
    return redirectWithCookies(request, response, "/workspace");
  }

  return response;
}
