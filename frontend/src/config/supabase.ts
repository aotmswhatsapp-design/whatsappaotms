/**
 * Supabase project coordinates. Both values are `NEXT_PUBLIC_*` because the
 * browser client needs them; the publishable key is safe to ship (it is the
 * replacement for the old anon key and carries no privileges beyond RLS).
 *
 * Nothing else from the Supabase dashboard belongs in the frontend — the
 * service-role key must never be referenced here, since it bypasses RLS.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local and fill both in.",
  );
}

export const supabaseConfig = { url, publishableKey } as const;
