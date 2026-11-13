"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
} from "lucide-react";

import { site } from "@/config/site";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Mode = "password" | "email-code";

const INPUT = [
  "h-11 w-full rounded-lg border border-border bg-white pl-10 pr-3",
  "text-[15px] text-foreground outline-none transition-all duration-200",
  "placeholder:text-muted-foreground/60 hover:border-muted-foreground/40",
  "focus:border-brand focus:ring-[3px] focus:ring-brand/15",
  "disabled:cursor-not-allowed disabled:bg-secondary/60 disabled:text-muted-foreground",
  // Chrome paints autofilled inputs pale blue, which fights the white card.
  "[&:-webkit-autofill]:[box-shadow:0_0_0_1000px_#ffffff_inset]",
  "[&:-webkit-autofill]:[-webkit-text-fill-color:#111111]",
].join(" ");

/**
 * Supabase returns machine-facing copy ("Invalid login credentials"). These are
 * the ones a real customer can hit, translated into something actionable.
 */
const MESSAGES: Record<string, string> = {
  "Invalid login credentials":
    "That email and password don't match. Check them and try again.",
  "Email not confirmed":
    "Confirm your address first — we emailed you a link when the account was created.",
  "Email rate limit exceeded":
    "Too many codes requested just now. Wait a minute, then try again.",
  "Invalid OTP": "That code is not right, or it has already expired.",
  "Token has expired or is invalid":
    "That code has expired. Request a fresh one.",
  "Signups not allowed for otp":
    "No account uses that email yet. Choose a plan and we'll set it up.",
  "User not found":
    "No account uses that email yet. Choose a plan and we'll set it up.",
  "Email address is invalid": "That email address doesn't look right.",
};

function friendly(message: string) {
  return MESSAGES[message] ?? message;
}

/**
 * Only same-origin relative paths are honoured. `//evil.com` is a
 * protocol-relative URL, so it has to be rejected alongside absolute ones.
 */
function nextPath() {
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/workspace";
  return raw;
}

function FieldShell({
  htmlFor,
  label,
  hint,
  children,
}: {
  htmlFor: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        className="flex items-center justify-between gap-3 text-xs font-semibold text-foreground"
        htmlFor={htmlFor}
      >
        {label}
        {hint ? (
          <span className="text-[11px] font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </label>
      <div className="relative mt-1.5">{children}</div>
    </div>
  );
}

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
          ? "bg-white text-foreground shadow-sm"
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
 * one-time code (the project is configured for 8-digit codes that live for an
 * hour). Google is offered through OAuth and lands on /auth/callback.
 */
export function LoginForm() {
  const router = useRouter();
  const id = React.useId();
  const emailId = `${id}-email`;
  const passwordId = `${id}-password`;
  const codeId = `${id}-code`;

  const [mode, setMode] = React.useState<Mode>("password");
  const [pending, setPending] = React.useState<
    "password" | "code" | "verify" | "google" | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [codeSent, setCodeSent] = React.useState(false);
  const [code, setCode] = React.useState("");

  function reset() {
    setError(null);
    setNotice(null);
  }

  function finish() {
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
      `We emailed an 8-digit code to ${address}. It expires in an hour.`,
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

  const submitLabel =
    mode === "password"
      ? "Sign in"
      : showCodeStep
        ? "Verify code"
        : "Email me a code";

  return (
    <div className="w-full rounded-2xl border border-border bg-white p-7 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_18px_40px_-24px_rgba(16,24,40,0.28)] sm:p-8">
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
            <input
              autoComplete="current-password"
              className={cn(INPUT, "pr-11")}
              id={passwordId}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              required
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
              onClick={() => setShowPassword((current) => !current)}
              type="button"
            >
              {showPassword ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>
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
              placeholder="00000000"
              required
              type="text"
              value={code}
            />
          </FieldShell>
        ) : null}

        <div className="flex items-center justify-between gap-3 text-xs">
          {mode === "password" ? (
            <button
              className="font-medium text-muted-foreground transition-colors hover:text-brand"
              onClick={() => switchMode("email-code")}
              type="button"
            >
              Forgot password?
            </button>
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

        <button
          className="group flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand/90 hover:shadow-lg hover:shadow-brand/25 focus-visible:ring-[3px] focus-visible:ring-brand/40 focus-visible:outline-none active:translate-y-0 active:shadow-none disabled:pointer-events-none disabled:opacity-70"
          disabled={busy}
          type="submit"
        >
          {pending === "password" ||
          pending === "code" ||
          pending === "verify" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {submitLabel}
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
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-semibold text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-muted-foreground/40 hover:bg-secondary/60 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-brand/25 focus-visible:outline-none active:translate-y-0 disabled:pointer-events-none disabled:opacity-70"
          disabled={busy}
          onClick={continueWithGoogle}
          type="button"
        >
          {pending === "google" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <svg aria-hidden="true" className="size-4" viewBox="0 0 48 48">
              <path
                d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039L38.802 8.841C34.553 4.806 29.613 2.5 24 2.5C11.983 2.5 2.5 11.983 2.5 24s9.483 21.5 21.5 21.5S45.5 36.017 45.5 24c0-1.538-.135-3.022-.389-4.417z"
                fill="#FFC107"
              />
              <path
                d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12.5 24 12.5c3.059 0 5.842 1.154 7.961 3.039l5.839-5.841C34.553 4.806 29.613 2.5 24 2.5C16.318 2.5 9.642 6.723 6.306 14.691z"
                fill="#FF3D00"
              />
              <path
                d="M24 45.5c5.613 0 10.553-2.306 14.802-6.341l-5.839-5.841C30.842 35.846 27.059 38 24 38c-5.039 0-9.345-2.608-11.124-6.481l-6.571 4.819C9.642 41.277 16.318 45.5 24 45.5z"
                fill="#4CAF50"
              />
              <path
                d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l5.839 5.841C44.196 35.123 45.5 29.837 45.5 24c0-1.538-.135-3.022-.389-4.417z"
                fill="#1976D2"
              />
            </svg>
          )}
          Google
        </button>

        <div aria-live="polite" className="space-y-2">
          {error ? (
            <p
              className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="rounded-lg border border-brand/20 bg-brand-soft px-3 py-2 text-xs leading-relaxed text-[#7c2d12]">
              {notice}
            </p>
          ) : null}
        </div>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        No account yet?{" "}
        <Link
          className="font-semibold text-brand underline-offset-4 transition-colors hover:text-[#9c3a11] hover:underline"
          href={site.links.pricing}
        >
          Choose a plan
        </Link>
      </p>
      <p className="mt-4 border-t border-border pt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
        Passwords need 8 or more characters with upper and lower case, a number
        and a symbol. Accounts are created once your payment is verified.
      </p>
    </div>
  );
}
