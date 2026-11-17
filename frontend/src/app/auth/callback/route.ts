import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

const LINK_PROBLEM =
  "That link has expired or has already been used. Request a fresh one and open it in this browser.";

function sendToLogin(origin: string, message: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

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

  // Supabase reports a rejected link as a query pair rather than an exception,
  // e.g. `?error=access_denied&error_code=otp_expired`.
  if (searchParams.has("error") || searchParams.has("error_code")) {
    return sendToLogin(origin, LINK_PROBLEM);
  }

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
  return sendToLogin(origin, LINK_PROBLEM);
}
