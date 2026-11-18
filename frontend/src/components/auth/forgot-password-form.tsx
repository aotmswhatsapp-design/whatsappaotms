"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, Mail, Send } from "lucide-react";

import {
  CARD,
  FieldShell,
  FormMessages,
  INPUT,
  SUBMIT,
  friendly,
} from "@/components/auth/form-bits";
import { createClient } from "@/lib/supabase/client";

/**
 * Requests a recovery link.
 *
 * The copy deliberately never says whether the address exists: Supabase answers
 * the same way either way, and a form that confirms accounts would hand an
 * attacker a customer list one guess at a time.
 */
export function ForgotPasswordForm() {
  const id = React.useId();
  const emailId = `${id}-email`;

  const [email, setEmail] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function sendLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const address = email.trim();
    if (!address) {
      setError("Enter the email address you signed up with.");
      return;
    }

    setPending(true);

    const { error: resetError } =
      await createClient().auth.resetPasswordForEmail(address, {
        // The callback exchanges the code, then hands the browser to the form
        // that writes the new password.
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          "/reset-password",
        )}`,
      });

    setPending(false);

    if (resetError) {
      setError(friendly(resetError.message));
      return;
    }

    setNotice(
      "If an account uses that address, a reset link is on its way. Open it in this browser — it expires in about an hour.",
    );
  }

  return (
    <div className={CARD}>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Reset your password
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        Tell us the address on the account and we&apos;ll email a link to set a
        new password.
      </p>

      <form className="mt-6 space-y-4" onSubmit={sendLink}>
        <FieldShell htmlFor={emailId} label="Work email">
          <Mail
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            autoComplete="email"
            autoFocus
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

        <FormMessages error={error} notice={notice} />

        <button className={SUBMIT} disabled={pending} type="submit">
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send
              aria-hidden="true"
              className="size-4 transition-transform group-hover:translate-x-1"
            />
          )}
          {pending ? "Sending" : "Send reset link"}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Remembered it?{" "}
        <Link
          className="font-semibold text-brand underline-offset-4 transition-colors hover:text-brand/80 hover:underline"
          href="/login"
        >
          Back to sign in
        </Link>
      </p>
      <p className="mt-4 border-t border-border pt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
        No account yet?{" "}
        <Link
          className="font-semibold text-foreground underline-offset-4 hover:underline"
          href="/signup"
        >
          Create one
        </Link>
        .
      </p>
    </div>
  );
}
