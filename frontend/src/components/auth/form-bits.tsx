"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared pieces of the auth screens. Every form on /login, /signup, /verify-email,
 * /forgot-password and /reset-password draws its field chrome, error copy and
 * redirect handling from here, so a change to one is a change to all of them.
 */

export const INPUT = [
  // `bg-secondary` rather than `bg-card`: on the white sheet the card is white
  // too, so a card-coloured field would be defined by its border alone.
  "h-11 w-full rounded-lg border border-input bg-secondary pl-10 pr-3",
  "text-[15px] text-foreground outline-none transition-all duration-200",
  "placeholder:text-muted-foreground/60 hover:border-brand/40",
  "focus:border-brand focus:ring-[3px] focus:ring-brand/15",
  "disabled:cursor-not-allowed disabled:bg-secondary/60 disabled:text-muted-foreground",
  // Chrome paints autofilled inputs pale blue, which fights the sheet. The fill
  // tracks the token, so it stays correct in every scope.
  "[&:-webkit-autofill]:[box-shadow:0_0_0_1000px_var(--secondary)_inset]",
  "[&:-webkit-autofill]:[-webkit-text-fill-color:#101010]",
].join(" ");

export const CARD =
  "w-full rounded-2xl border border-border bg-card p-7 shadow-[0_1px_2px_rgba(16,16,16,0.04),0_24px_48px_-30px_rgba(16,16,16,0.22)] sm:p-8";

export const SUBMIT =
  "group flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-brand-foreground shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand/90 hover:shadow-lg hover:shadow-brand/25 focus-visible:ring-[3px] focus-visible:ring-brand/40 focus-visible:outline-none active:translate-y-0 active:shadow-none disabled:cursor-progress disabled:opacity-70";

export const GHOST_BUTTON =
  "flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-muted-foreground/40 hover:bg-secondary/60 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-brand/25 focus-visible:outline-none active:translate-y-0 disabled:cursor-progress disabled:opacity-70";

/**
 * Supabase returns machine-facing copy. These are the ones a real customer can
 * hit, translated into something actionable.
 */
const MESSAGES: Record<string, string> = {
  "Invalid login credentials":
    "That email and password don't match. Check them and try again.",
  "Email not confirmed":
    "Confirm your address first — we emailed you a code when the account was created.",
  "Email rate limit exceeded":
    "Too many emails requested just now. Wait a minute, then try again.",
  "Invalid OTP": "That code is not right, or it has already expired.",
  "Token has expired or is invalid":
    "That code is wrong or has expired. Request a fresh one.",
  "Signups not allowed for otp":
    "No account uses that email yet. Create one and we'll get you set up.",
  "User not found":
    "No account uses that email yet. Create one and we'll get you set up.",
  "Email address is invalid": "That email address doesn't look right.",
  "User already registered":
    "That email already has an account. Sign in instead.",
  "Password should be at least 6 characters":
    "Use at least 8 characters with upper and lower case, a number and a symbol.",
  "New password should be different from the old password":
    "That is already your password. Choose a different one.",
  "Auth session missing!":
    "That link has expired. Request a fresh one and open it in this browser.",
};

const PATTERNS: Array<[RegExp, string]> = [
  // Supabase quotes the address back, so it can never be a map key.
  [
    /^Email address .* is invalid$/i,
    "That email address doesn't look right. Try a different one.",
  ],
];

export function friendly(message: string) {
  if (MESSAGES[message]) return MESSAGES[message];
  for (const [pattern, copy] of PATTERNS) {
    if (pattern.test(message)) return copy;
  }
  return message;
}

/**
 * Only same-origin relative paths are honoured. `//evil.com` is a
 * protocol-relative URL, so it has to be rejected alongside absolute ones.
 */
export function nextPath() {
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/workspace";
  return raw;
}

export function FieldShell({
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

/** A password box with the reveal toggle; the icon sits inside the padding. */
export function PasswordInput({
  id,
  name,
  value,
  onChange,
  autoComplete,
  placeholder,
  invalid,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  placeholder: string;
  invalid?: boolean;
}) {
  const [visible, setVisible] = React.useState(false);

  return (
    <>
      <input
        aria-invalid={invalid || undefined}
        autoComplete={autoComplete}
        className={cn(INPUT, "pr-11")}
        id={id}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required
        type={visible ? "text" : "password"}
        value={value}
      />
      <button
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
        onClick={() => setVisible((current) => !current)}
        type="button"
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </>
  );
}

/** The four-colour mark, kept inline so the page needs no extra request. */
export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className ?? "size-4"} viewBox="0 0 48 48">
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
  );
}

/**
 * One slot for the error/notice pair every form shows above its button.
 *
 * Renders nothing when both are empty: an always-present wrapper would add a
 * second 16px gap above the submit button (the form spaces its children).
 * The error paragraph carries role="alert", which is announced when it mounts.
 */
export function FormMessages({
  error,
  notice,
}: {
  error: string | null;
  notice: string | null;
}) {
  if (!error && !notice) return null;

  return (
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
        <p className="rounded-lg border border-brand/20 bg-brand-soft px-3 py-2 text-xs leading-relaxed text-brand">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
