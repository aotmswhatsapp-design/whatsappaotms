import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthShell } from "../_components/auth-shell";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";

export const metadata: Metadata = { title: "Confirm your email" };

type Search = { email?: string | string[] };

/**
 * `searchParams` is a promise, so reading it needs a Suspense boundary above —
 * that is what keeps /verify-email in the static shell while still prefilling
 * the address from /signup.
 */
async function CodeStep({ searchParams }: { searchParams: Promise<Search> }) {
  const { email } = await searchParams;
  const initialEmail = Array.isArray(email) ? email[0] : (email ?? "");

  return <VerifyEmailForm initialEmail={initialEmail} />;
}

export default function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  return (
    <AuthShell>
      <Suspense fallback={<VerifyEmailForm />}>
        <CodeStep searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
