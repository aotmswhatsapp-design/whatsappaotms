import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthShell } from "../_components/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { safeNext } from "@/lib/auth/next-path";

export const metadata: Metadata = { title: "Log in" };

type Search = {
  error?: string | string[];
  notice?: string | string[];
  next?: string | string[];
};

function first(value: string | string[] | undefined) {
  const read = Array.isArray(value) ? value[0] : value;
  return read?.trim() ? read : null;
}

/**
 * The callback route lands failures back here with `?error=`, and the proxy
 * uses `?next=`. The form reads it again at submit time, but it also needs it
 * now: an invitee who has no account has to reach sign-up without losing the
 * invitation, and that link is rendered on the server.
 */
async function LoginStep({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;

  return (
    <LoginForm
      initialError={first(params.error)}
      initialNotice={first(params.notice)}
      next={safeNext(params.next)}
    />
  );
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  return (
    <AuthShell>
      <Suspense fallback={<LoginForm />}>
        <LoginStep searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
