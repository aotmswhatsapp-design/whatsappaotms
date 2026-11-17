import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthShell } from "../_components/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Log in" };

type Search = { error?: string | string[]; notice?: string | string[] };

function first(value: string | string[] | undefined) {
  const read = Array.isArray(value) ? value[0] : value;
  return read?.trim() ? read : null;
}

/**
 * The callback route lands failures back here with `?error=`, and the proxy
 * uses `?next=` — that one is read on the client, because the form needs the
 * value at submit time.
 */
async function LoginStep({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;

  return (
    <LoginForm
      initialError={first(params.error)}
      initialNotice={first(params.notice)}
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
