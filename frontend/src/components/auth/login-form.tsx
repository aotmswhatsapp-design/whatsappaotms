"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, Loader2, Lock, Mail } from "lucide-react";

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
import { invalidateWorkspaceRole } from "@/lib/api/workspace";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Mode = "password" | "email-code";

function ModeButton({
  active,
  icon: Icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-selected={active}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-all duration-200",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
      role="tab"
      type="button"
    >
      <Icon aria-hidden className="size-3.5" />
      {children}
    </button>
  );
}

/**
 * Real Supabase sign-in. Two paths share one form: password, and an emailed
 * one-time code (codes expire after an hour). Google is offered through OAuth
 * and lands on /auth/callback.
 */
export function LoginForm({
  initialError = null,
  initialNotice = null,
}: {
  initialError?: string | null;
  initialNotice?: string | null;
}) {
  const router = useRouter();
  const id = React.useId();
  const emailId = `${id}-email`;
  const passwordId = `${id}-password`;
  const codeId = `${id}-code`;

  const [mode, setMode] = React.useState<Mode>("password");
  const [pending, setPending] = React.useState<
    "password" | "code" | "verify" | "google" | null
  >(null);
  const [error, setError] = React.useState<string | null>(initialError);
  const [notice, setNotice] = React.useState<string | null>(initialNotice);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [codeSent, setCodeSent] = React.useState(false);
  const [code, setCode] = React.useState("");

  function reset() {
    setError(null);
    setNotice(null);
  }

  function finish() {
    // A successful sign-in may be a different account than the one this tab
    // served last; whatever role was cached belonged to that person — here and
    // in every other tab, which shares this session.
    invalidateWorkspaceRole();
    router.replace(nextPath());
    router.refresh();
  }

  /** Switching method must not carry a stale error from the other one. */
  function switchMode(next: Mode) {
    reset();
    setMode(next);
    if (next === "password") {
      setCodeSent(false);
      setCode("");
    }
  }

  async function signInWithPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    reset();
    setPending("password");

    const { error: signInError } = await createClient().auth.signInWithPassword(
      { email: email.trim(), password },
    );

    if (signInError) {
      setError(friendly(signInError.message));
      setPending(null);
      return;
    }

    // Keep the button busy: the redirect is in flight, and re-enabling it here
    // invites a double submit.
    finish();
  }

  async function requestCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    reset();
    setPending("code");

    const address = email.trim();
    const { error: otpError } = await createClient().auth.signInWithOtp({
      email: address,
      options: {
        // Accounts are provisioned with the paid plan, so an unknown address is
        // a support case, not a silent new tenant.
        shouldCreateUser: false,
      },
    });

    setPending(null);

    if (otpError) {
      setError(friendly(otpError.message));
      return;
    }

    setCodeSent(true);
    setNotice(
      `We emailed a sign-in code to ${address}. It expires in an hour.`,
    );
  }

  async function verifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    reset();
    setPending("verify");

    const { error: verifyError } = await createClient().auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });

    if (verifyError) {
      setError(friendly(verifyError.message));
      setPending(null);
      return;
    }

    finish();
  }

  async function continueWithGoogle() {
    reset();
    setPending("google");

    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
      nextPath(),
    )}`;

    // On success the browser navigates away, so `pending` intentionally stays
    // set — clearing it would flash the idle button during the redirect.
    const { error: oauthError } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (oauthError) {
      setError(friendly(oauthError.message));
      setPending(null);
    }
  }

  const showCodeStep = mode === "email-code" && codeSent;
  const busy = pending !== null;
  const submitting =
    pending === "password" || pending === "code" || pending === "verify";

  const submitLabel =
    mode === "password"
      ? "Sign in"
      : showCodeStep
        ? "Verify code"
        : "Email me a code";

  // The busy label names the operation rather than restating the button, so a
  // slow round trip reads as work in progress instead of a dead control.
  const submitBusyLabel =
    mode === "password"
      ? "Signing in…"
      : showCodeStep
        ? "Verifying…"
        : "Sending code…";

  return (
    <div className={CARD}>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Welcome back
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Sign in to manage your WhatsApp workspace.
      </p>

      <div
        aria-label="Sign-in method"
        className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1"
        role="tablist"
      >
        <ModeButton
          active={mode === "password"}
          icon={Lock}
          onClick={() => switchMode("password")}
        >
          Password
        </ModeButton>
        <ModeButton
          active={mode === "email-code"}
          icon={KeyRound}
          onClick={() => switchMode("email-code")}
        >
          Email code
        </ModeButton>
      </div>

      <form
        className="mt-5 space-y-4"
        onSubmit={
          mode === "password"
            ? signInWithPassword
            : showCodeStep
              ? verifyCode
              : requestCode
        }
      >
        <FieldShell htmlFor={emailId} label="Email address">
          <Mail
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            autoComplete="email"
            className={INPUT}
            disabled={showCodeStep}
            id={emailId}
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            required
            type="email"
            value={email}
          />
        </FieldShell>

        {mode === "password" ? (
          <FieldShell htmlFor={passwordId} label="Password">
            <Lock
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <PasswordInput
              autoComplete="current-password"
              id={passwordId}
              name="password"
              onChange={setPassword}
              placeholder="Your password"
              value={password}
            />
          </FieldShell>
        ) : null}

        {showCodeStep ? (
          <FieldShell htmlFor={codeId} label="One-time code">
            <KeyRound
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              autoComplete="one-time-code"
              className={cn(INPUT, "font-mono tracking-[0.35em]")}
              id={codeId}
              inputMode="numeric"
              maxLength={8}
              name="code"
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 8))
              }
              placeholder="Code from the email"
              required
              type="text"
              value={code}
            />
          </FieldShell>
        ) : null}

        <div className="flex items-center justify-end gap-3 text-xs">
          {mode === "password" ? (
            <Link
              className="font-medium text-muted-foreground transition-colors hover:text-brand"
              href="/forgot-password"
            >
              Forgot password?
            </Link>
          ) : (
            <button
              className="font-medium text-muted-foreground transition-colors hover:text-brand disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                setCodeSent(false);
                setCode("");
                reset();
              }}
              type="button"
            >
              Use a different address
            </button>
          )}
          <span className="text-[11px] text-muted-foreground">
            {mode === "email-code" ? "Codes expire after 1 hour" : null}
          </span>
        </div>

        <FormMessages error={error} notice={notice} />

        <button
          aria-busy={submitting || undefined}
          className={SUBMIT}
          disabled={busy}
          type="submit"
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {submitting ? submitBusyLabel : submitLabel}
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
          aria-busy={pending === "google" || undefined}
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
        No account yet?{" "}
        <Link
          className="font-semibold text-brand underline-offset-4 transition-colors hover:text-brand/80 hover:underline"
          href="/signup"
        >
          Create an account
        </Link>
      </p>
      <p className="mt-4 border-t border-border pt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
        Passwords need 8 or more characters with upper and lower case, a number
        and a symbol.
      </p>
    </div>
  );
}
