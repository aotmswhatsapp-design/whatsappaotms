import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthShell } from "../_components/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";
import { safeNext } from "@/lib/auth/next-path";

export const metadata: Metadata = { title: "Create your account" };

type Search = { next?: string | string[] };

/**
 * `next` is an invitation link more often than not: the login screen hands it
 * over so the new account finishes sign-up on the page that needs it, rather
 * than on the workspace it would otherwise provision for itself.
 */
async function SignupStep({ searchParams }: { searchParams: Promise<Search> }) {
  const next = safeNext((await searchParams).next);

  return <SignupForm next={next} />;
}

export default function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  return (
    <AuthShell>
      <Suspense fallback={<SignupForm />}>
        <SignupStep searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
