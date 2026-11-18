"use client";

import * as React from "react";
import { KeyRound, LoaderCircle, PlugZap, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  ApiError,
  connectWhatsApp,
  type ConnectInput,
  type Verdict,
  type WhatsAppAccount,
} from "./api";

type FieldKey = keyof ConnectInput;
type Values = Record<FieldKey, string>;
type Errors = Partial<Record<FieldKey, string>>;

/** Asked in exactly the order the setup notes list them. */
const FIELDS: {
  name: FieldKey;
  label: string;
  placeholder: string;
  hint: string;
  inputMode?: "numeric" | "text";
}[] = [
  {
    name: "accessToken",
    label: "Meta access token",
    placeholder: "EAAG…",
    hint: "Business settings → Users → System users → Generate token. It starts with EAA and is 100+ characters.",
  },
  {
    name: "phoneNumberId",
    label: "Meta phone number ID",
    placeholder: "109876543210987",
    hint: "WhatsApp Manager → Phone numbers → the numeric ID shown under the display number. Not the phone number itself.",
    inputMode: "numeric",
  },
  {
    name: "appSecret",
    label: "App secret",
    placeholder: "32 characters from App settings → Basic",
    hint: "App settings → Basic → App secret → Show. Meta signs every webhook delivery with it, which is how the API proves a call is really from Meta.",
  },
  {
    name: "graphVersion",
    label: "Graph API version",
    placeholder: "v21.0",
    hint: "The version printed at the top of Meta's WhatsApp docs. Every request uses it.",
  },
  {
    name: "businessAccountId",
    label: "Business account ID",
    placeholder: "102290129340398",
    hint: "WhatsApp Business Account (WABA) ID — Business settings → Accounts → WhatsApp accounts.",
    inputMode: "numeric",
  },
];

const INITIAL: Values = {
  accessToken: "",
  phoneNumberId: "",
  appSecret: "",
  graphVersion: "v21.0",
  businessAccountId: "",
};

/**
 * Client rules mirror the server DTO so a typo is answered instantly instead
 * of as a 400. The server stays authoritative: it re-checks all five.
 */
const RULES: Record<FieldKey, (value: string) => string | null> = {
  accessToken: (value) =>
    value.length >= 20 ? null : "That looks truncated — paste the whole token.",
  phoneNumberId: (value) =>
    /^\d{5,25}$/.test(value)
      ? null
      : "Digits only. This is the ID, not the display phone number.",
  appSecret: (value) =>
    /^[A-Za-z0-9_-]{16,128}$/.test(value)
      ? null
      : "16–128 letters, digits, dashes or underscores — no spaces.",
  graphVersion: (value) =>
    /^v\d{1,2}\.\d$/.test(value) ? null : "Format is v21.0 (v, the number, a dot, then one digit).",
  businessAccountId: (value) =>
    /^\d{5,25}$/.test(value)
      ? null
      : "Digits only, from the WABA settings.",
};

function validate(values: Values): Errors {
  const errors: Errors = {};

  for (const field of FIELDS) {
    const message = RULES[field.name](values[field.name]);
    if (message) errors[field.name] = message;
  }

  return errors;
}

export function ConnectForm({
  existing,
  onVerdict,
  onConnected,
}: {
  /** An account is already stored, so these values replace it. */
  existing: boolean;
  onVerdict: (verdict: Verdict) => void;
  onConnected: (account: WhatsAppAccount) => void;
}) {
  const toast = useToast();
  const [values, setValues] = React.useState<Values>(INITIAL);
  const [errors, setErrors] = React.useState<Errors>({});
  const [pending, setPending] = React.useState(false);

  function update(name: FieldKey, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    // Clear the complaint as soon as the field stops being the same value.
    setErrors((current) => (current[name] ? { ...current, [name]: undefined } : current));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) return;

    const found = validate(values);
    setErrors(found);

    const firstInvalid = FIELDS.find((field) => found[field.name]);

    if (firstInvalid) {
      toast.push({
        tone: "error",
        title: "Some details need attention",
        description: found[firstInvalid.name],
        duration: 6_000,
      });
      document.getElementById(`wa-${firstInvalid.name}`)?.focus();
      return;
    }

    setPending(true);

    try {
      const result = await connectWhatsApp(values);
      const verdict: Verdict = {
        ok: result.ok,
        summary: result.summary,
        checks: result.checks,
      };

      onVerdict(verdict);

      if (result.account) {
        onConnected(result.account);
        // The credentials are stored now; leaving a live token rendered in a
        // text field serves no one. Keep the ids for a later edit.
        setValues((current) => ({ ...current, accessToken: "", appSecret: "" }));
      }

      toast.push({
        tone: result.ok ? "success" : "error",
        title: result.ok ? "Credentials verified" : "Meta did not accept these details",
        description: result.summary,
        checks: result.checks.map((check) => ({
          label: check.label,
          state: check.state,
          detail: check.detail,
        })),
        duration: result.ok ? 10_000 : 0,
      });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "The API call failed before Meta was reached.";

      onVerdict({ ok: false, summary: message, checks: [] });

      toast.push({
        tone: "error",
        title: "Could not run the check",
        description: message,
        duration: 0,
      });
    } finally {
      setPending(false);
    }
  }

  const filled = FIELDS.filter((field) => values[field.name].trim().length > 0).length;

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <KeyRound className="size-4 text-brand" aria-hidden="true" />
            {existing ? "Replace the credentials" : "Connection details"}
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Each value is checked against Meta before anything is stored. A
            rejected value never reaches the database.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          {filled}/5 filled
        </span>
      </div>

      <div className="space-y-4">
        {FIELDS.map((field, index) => {
          const error = errors[field.name];

          return (
            <div key={field.name}>
              <Label className="justify-between gap-3" htmlFor={`wa-${field.name}`}>
                <span className="flex items-center gap-1.5">
                  <span className="grid size-4 place-items-center rounded-full bg-secondary text-[9px] font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  {field.label}
                </span>
                {error ? (
                  <span className="text-[11px] font-medium text-destructive">{error}</span>
                ) : null}
              </Label>
              <input
                aria-describedby={`wa-${field.name}-hint`}
                aria-invalid={error ? true : undefined}
                autoCapitalize="off"
                autoComplete="off"
                className={cn(
                  "mt-1.5 h-10 w-full rounded-lg border bg-background px-3 font-mono text-[13px] text-foreground shadow-xs outline-none transition-shadow",
                  "placeholder:font-sans placeholder:text-[12px] placeholder:text-muted-foreground/70",
                  "focus-visible:ring-[3px]",
                  error
                    ? "border-destructive/60 focus-visible:border-destructive focus-visible:ring-destructive/20"
                    : "border-input focus-visible:border-ring focus-visible:ring-ring/30",
                )}
                id={`wa-${field.name}`}
                inputMode={field.inputMode ?? "text"}
                onChange={(event) => update(field.name, event.target.value)}
                placeholder={field.placeholder}
                spellCheck={false}
                type="text"
                value={values[field.name]}
              />
              <p
                className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground"
                id={`wa-${field.name}-hint`}
              >
                {field.hint}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
        <Button className="w-full sm:w-auto" disabled={pending} size="lg" type="submit" variant="brand">
          {pending ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Asking Meta…
            </>
          ) : (
            <>
              <PlugZap aria-hidden="true" />
              {existing ? "Verify and replace" : "Confirm and verify"}
            </>
          )}
        </Button>
        <Button
          className="w-full sm:w-auto"
          disabled={pending}
          onClick={() => {
            setValues(INITIAL);
            setErrors({});
          }}
          type="button"
          variant="ghost"
        >
          <RotateCcw aria-hidden="true" />
          Clear
        </Button>
      </div>
    </form>
  );
}
