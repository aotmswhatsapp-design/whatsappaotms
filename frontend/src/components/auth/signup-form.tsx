"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Lock, Mail, User } from "lucide-react";

import {
  CARD,
  FieldShell,
  FormMessages,
  GHOST_BUTTON,
  GoogleIcon,
  INPUT,
  PasswordInput,
  SUBMIT,
  friendly,
  nextPath,
} from "@/components/auth/form-bits";
import { passwordProblem, passwordScore } from "@/lib/auth/password";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Creates the Supabase account, then hands off to /verify-email.
 *
 * Supabase deliberately does not reveal whether an address is already taken: a
 * repeat sign-up returns a user object with an empty `identities` array and
 * sends no mail. That empty array is the only honest duplicate signal, so it is
 * what the form checks before promising a code.
 */
export function SignupForm({ next = null }: { next?: string | null }) {
  const router = useRouter();
  const id = React.useId();
  const nameId = `${id}-name`;
  const emailId = `${id}-email`;
  const passwordId = `${id}-password`;
  const confirmId = `${id}-confirm`;

  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [pending, setPending] = React.useState<"create" | "google" | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);

  const busy = pending !== null;
  const score = passwordScore(password);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function createAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }

    setPending("create");

    const address = email.trim();
    const { data, error: signUpError } = await createClient().auth.signUp({
      email: address,
      password,
      options: {
        // Google's callback lands on the same route, so both paths converge.
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          nextPath(),
        )}`,
        data: fullName.trim() ? { full_name: fullName.trim() } : undefined,
      },
    });

    if (signUpError) {
      setError(friendly(signUpError.message));
      setPending(null);
      return;
    }

    // Address already registered: no mail was sent, and the empty identities
    // array is how Supabase says so without leaking which addresses exist.
    if (data.user && data.user.identities?.length === 0) {
      setError(
        "That email already has an account. Sign in instead, or reset the password.",
      );
      setPending(null);
      return;
    }

    // Confirmation switched off in the project: the session is already live.
    if (data.session) {
      router.replace(nextPath());
      router.refresh();
      return;
    }

    // The invitation arrived here as `next`; forwarding it is what keeps the
    // code step pointing at the join page. Without it the first visit to
    // /workspace provisions a workspace of this account's own, and the team
    // that invited them becomes unreachable.
    const landing = next ?? nextPath();
    const query = new URLSearchParams({ email: address });
    if (landing !== "/workspace") query.set("next", landing);

    router.push(`/verify-email?${query.toString()}`);
  }

  async function continueWithGoogle() {
    setError(null);
    setPending("google");

    const { error: oauthError } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          nextPath(),
        )}`,
      },
    });

    // On success the browser leaves the page; only a failure needs a reset.
    if (oauthError) {
      setError(friendly(oauthError.message));
      setPending(null);
    }
  }

  return (
    <div className={CARD}>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Create your account
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        We&apos;ll email a confirmation code to confirm your address.
      </p>

      <form className="mt-6 space-y-4" onSubmit={createAccount}>
        <FieldShell htmlFor={nameId} label="Full name" hint="Optional">
          <User
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            autoComplete="name"
            className={INPUT}
            id={nameId}
            name="name"
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Priya Sharma"
            type="text"
            value={fullName}
          />
        </FieldShell>

        <FieldShell htmlFor={emailId} label="Work email">
          <Mail
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            autoComplete="email"
            className={INPUT}
            id={emailId}
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            required
            type="email"
            value={email}
          />
        </FieldShell>

        <FieldShell htmlFor={passwordId} label="Password">
          <Lock
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <PasswordInput
            autoComplete="new-password"
            id={passwordId}
            name="password"
            onChange={setPassword}
            placeholder="At least 8 characters"
            value={password}
          />
        </FieldShell>

        {password ? (
          <div aria-hidden="true" className="flex items-center gap-1.5">
            {[1, 2, 3, 4].map((step) => (
              <span
                key={step}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors duration-300",
                  score >= step ? "bg-brand" : "bg-border",
                )}
              />
            ))}
            <span className="ml-1 text-[11px] text-muted-foreground">
              {["Weak", "Weak", "Fair", "Good", "Strong"][score]}
            </span>
          </div>
        ) : null}

        <FieldShell htmlFor={confirmId} label="Confirm password">
          <Lock
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <PasswordInput
            autoComplete="new-password"
            id={confirmId}
            invalid={mismatch}
            name="confirm"
            onChange={setConfirm}
            placeholder="Repeat your password"
            value={confirm}
          />
        </FieldShell>

        <FormMessages error={error} notice={null} />

        <button
          aria-busy={pending === "create" || undefined}
          className={SUBMIT}
          disabled={busy}
          type="submit"
        >
          {pending === "create" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {pending === "create" ? "Creating account…" : "Create account"}
          {busy ? null : (
            <ArrowRight
              aria-hidden="true"
              className="size-4 transition-transform group-hover:translate-x-1"
            />
          )}
        </button>

        <div className="flex items-center">
          <span className="h-px flex-1 bg-border" />
          <span className="mx-3 text-[11px] tracking-wide text-muted-foreground">
            OR CONTINUE WITH
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <button
          className={GHOST_BUTTON}
          disabled={busy}
          onClick={continueWithGoogle}
          type="button"
        >
          {pending === "google" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <GoogleIcon />
          )}
          Google
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link
          className="font-semibold text-brand underline-offset-4 transition-colors hover:text-brand/80 hover:underline"
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
        >
          Sign in
        </Link>
      </p>
      <p className="mt-4 border-t border-border pt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
        Passwords need 8 or more characters with upper and lower case, a number
        and a symbol.
      </p>
    </div>
  );
}
