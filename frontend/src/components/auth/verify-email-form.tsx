"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";

import {
  CARD,
  FieldShell,
  FormMessages,
  SUBMIT,
  friendly,
  INPUT,
  nextPath,
} from "@/components/auth/form-bits";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * The longest code Supabase can be configured to mail. The project's own email
 * OTP length is a dashboard setting, so the copy says "your code" and the
 * check accepts anything from 6 up rather than promising a fixed width.
 */
const CODE_LENGTH = 8;
const MIN_CODE_LENGTH = 6;
const RESEND_SECONDS = 60;

/**
 * Confirms the address with the emailed one-time code.
 *
 * The email is prefilled from /signup but stays editable: a customer who
 * mistyped the address should be able to fix it here instead of starting over.
 */
export function VerifyEmailForm({ initialEmail = "" }: { initialEmail?: string }) {
  const router = useRouter();
  const id = React.useId();
  const emailId = `${id}-email`;
  const codeId = `${id}-code`;

  const [email, setEmail] = React.useState(initialEmail);
  const [code, setCode] = React.useState("");
  const [pending, setPending] = React.useState<"verify" | "resend" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  // Arriving from /signup means an email just went out, and the server already
  // enforces a 60s cooldown per address. Starting the countdown here keeps the
  // button honest instead of letting a click bounce off a 429.
  const [cooldown, setCooldown] = React.useState(() =>
    initialEmail ? RESEND_SECONDS : 0,
  );

  const busy = pending !== null;

  // One timeout per second rather than an interval: nothing to clear early and
  // no chance of two ticks racing the same state.
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const address = email.trim();
    const token = code.trim();

    if (!address) {
      setError("Enter the email address we sent the code to.");
      return;
    }
    // Six is Supabase's shortest possible code, so a project left on the
    // default length still confirms from this screen.
    if (!/^\d{6,8}$/.test(token)) {
      setError("Enter the code from the email. It is 6 to 8 digits.");
      return;
    }

    setPending("verify");
    const client = createClient();

    // `signup` is the type minted for a brand-new account. Addresses invited or
    // re-mailed through the passwordless flow get an `email` token, so a
    // rejected `signup` code is retried once under that type.
    let failure = (
      await client.auth.verifyOtp({ email: address, token, type: "signup" })
    ).error;

    if (failure) {
      failure = (
        await client.auth.verifyOtp({ email: address, token, type: "email" })
      ).error;
    }

    if (failure) {
      setError(friendly(failure.message));
      setPending(null);
      return;
    }

    router.replace(nextPath());
    router.refresh();
  }

  async function resend() {
    if (busy || cooldown > 0) return;

    setError(null);
    setNotice(null);
    setPending("resend");

    const { error: resendError } = await createClient().auth.resend({
      type: "signup",
      email: email.trim(),
    });

    setPending(null);

    if (resendError) {
      setError(friendly(resendError.message));
      return;
    }

    setCooldown(RESEND_SECONDS);
    setNotice("A new code is on its way. It can take a minute to arrive.");
  }

  return (
    <div className={CARD}>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Check your inbox
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        We sent a confirmation code to{" "}
        <span className="font-semibold text-foreground break-words">
          {email.trim() || "your email"}
        </span>
        . Enter it below to finish setting up your account.
      </p>

      <form className="mt-6 space-y-4" onSubmit={confirm}>
        <FieldShell
          hint={`${MIN_CODE_LENGTH}–${CODE_LENGTH} digits`}
          htmlFor={codeId}
          label="Confirmation code"
        >
          <input
            autoComplete="one-time-code"
            // Digits only, so a pasted "123 456" still lands as 123456.
            className={cn(
              INPUT,
              "pl-3 text-center text-lg font-semibold tracking-[0.4em]",
            )}
            id={codeId}
            inputMode="numeric"
            maxLength={CODE_LENGTH}
            name="code"
            onChange={(event) =>
              setCode(
                event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH),
              )
            }
            required
            type="text"
            value={code}
          />
        </FieldShell>

        <FieldShell htmlFor={emailId} label="Email" hint="Change if it's wrong">
          <input
            autoComplete="email"
            className={cn(INPUT, "pl-3")}
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

        <button
          aria-busy={pending === "verify" || undefined}
          className={SUBMIT}
          disabled={busy}
          type="submit"
        >
          {pending === "verify" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {pending === "verify" ? "Confirming…" : "Confirm email"}
          {busy ? null : (
            <ArrowRight
              aria-hidden="true"
              className="size-4 transition-transform group-hover:translate-x-1"
            />
          )}
        </button>
      </form>

      <div className="mt-6 space-y-3 border-t border-border pt-5 text-center">
        <p className="text-xs text-muted-foreground">
          Nothing arrived? Check the spam folder, then{" "}
          <button
            className="font-semibold text-brand underline-offset-4 transition-colors hover:text-brand/80 hover:underline disabled:pointer-events-none disabled:text-muted-foreground disabled:no-underline"
            disabled={busy || cooldown > 0}
            onClick={resend}
            type="button"
          >
            {cooldown > 0 ? `resend in ${cooldown}s` : "send a new code"}
          </button>
          .
        </p>
        <p className="text-xs text-muted-foreground">
          <Link
            className="font-semibold text-brand underline-offset-4 transition-colors hover:text-brand/80 hover:underline"
            href="/signup"
          >
            Use a different email
          </Link>
          <span className="mx-2 text-border">|</span>
          <Link
            className="font-semibold text-brand underline-offset-4 transition-colors hover:text-brand/80 hover:underline"
            href="/login"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
