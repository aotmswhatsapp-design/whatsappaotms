"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Lock } from "lucide-react";

import {
  CARD,
  FieldShell,
  FormMessages,
  PasswordInput,
  SUBMIT,
  nextPath,
} from "@/components/auth/form-bits";
import { passwordProblem, passwordScore } from "@/lib/auth/password";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Writes the new password.
 *
 * The browser is already signed in by the time it lands here: /auth/callback
 * exchanged the recovery code for a session, so `updateUser` needs no token of
 * its own. That also means an expired link shows up as a missing session rather
 * than a malformed URL, which is why that message is translated below.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const id = React.useId();
  const passwordId = `${id}-password`;
  const confirmId = `${id}-confirm`;

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [expired, setExpired] = React.useState(false);

  const score = passwordScore(password);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function save(event: React.FormEvent<HTMLFormElement>) {
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

    setPending(true);

    const { error: updateError } = await createClient().auth.updateUser({
      password,
    });

    if (updateError) {
      setExpired(updateError.message === "Auth session missing!");
      setError(
        updateError.message === "Auth session missing!"
          ? "That link has expired or was already used. Request a fresh one and open it in this browser."
          : updateError.message,
      );
      setPending(false);
      return;
    }

    // The new password invalidates every other session; this one stays, so the
    // customer goes straight into the workspace instead of signing in again.
    router.replace(nextPath());
    router.refresh();
  }

  return (
    <div className={CARD}>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Choose a new password
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        Pick something you haven&apos;t used on this account before.
      </p>

      <form className="mt-6 space-y-4" onSubmit={save}>
        <FieldShell htmlFor={passwordId} label="New password">
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

        <FieldShell htmlFor={confirmId} label="Confirm new password">
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

        <button className={SUBMIT} disabled={pending} type="submit">
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          Save password
          {pending ? null : (
            <ArrowRight
              aria-hidden="true"
              className="size-4 transition-transform group-hover:translate-x-1"
            />
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        {expired ? (
          <>
            <Link
              className="font-semibold text-brand underline-offset-4 transition-colors hover:text-[#9c3a11] hover:underline"
              href="/forgot-password"
            >
              Send me a new link
            </Link>
            <span className="mx-2 text-border">|</span>
          </>
        ) : null}
        <Link
          className="font-semibold text-brand underline-offset-4 transition-colors hover:text-[#9c3a11] hover:underline"
          href="/login"
        >
          Back to sign in
        </Link>
      </p>
      <p className="mt-4 border-t border-border pt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
        Passwords need 8 or more characters with upper and lower case, a number
        and a symbol.
      </p>
    </div>
  );
}
