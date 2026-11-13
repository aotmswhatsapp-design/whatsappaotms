"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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
