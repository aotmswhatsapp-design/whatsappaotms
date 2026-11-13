import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * Single landing point for every Supabase redirect:
 *
 * - `?code=…`      — PKCE flow, used by Google OAuth and email links.
 * - `?token_hash=…` — the verify endpoint Supabase email templates can point
 *                     at directly instead of the default hosted page.
 *
 * The session is written to cookies by `createClient()`'s `setAll`, so the
 * redirect below already carries a signed-in browser.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  // Never bounce off-site: `//evil.com` is protocol-relative.
  const requested = searchParams.get("next");
  const next =
    requested && requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/workspace";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  // Expired, already-used, or tampered link — the user needs a fresh one.
  return NextResponse.redirect(new URL("/login", origin));
}
