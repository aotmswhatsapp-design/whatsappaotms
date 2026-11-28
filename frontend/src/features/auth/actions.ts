"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/next-path";

/**
 * Clears the Supabase session and returns to the marketing site.
 *
 * `redirect()` throws a control-flow signal, so it stays outside any try/catch.
 * The revalidate clears the client Router Cache, otherwise the navbar can keep
 * rendering the old avatar after sign-out.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Clears the session and comes back to the page that needed a different
 * account.
 *
 * An invitation link is why this exists. It is matched against the address the
 * visitor is signed in with, so using it as the wrong person is refused — and
 * the only way forward is to sign in as the invited one. Signing out from any
 * other screen would lose the token, which is the whole proof, so the caller
 * passes the path to return to. `safeNext` keeps that path inside the app.
 */
export async function signOutTo(formData: FormData) {
  const next = safeNext(String(formData.get("next") ?? ""));

  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect(next ?? "/");
}
