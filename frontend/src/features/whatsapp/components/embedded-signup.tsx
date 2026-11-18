"use client";

import * as React from "react";
import { CircleAlert, LoaderCircle, ShieldCheck, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import {
  ApiError,
  connectEmbeddedSignup,
  type SignupConfig,
  type WhatsAppAccount,
} from "./api";
import { preloadSignupSdk, runEmbeddedSignup } from "./facebook-sdk";

/**
 * The path almost everyone should take: one button, no keys to copy.
 *
 * Everything the customer could get wrong — the token, the ids, the webhook —
 * is either collected by Meta's dialog or done by the API afterwards, so the
 * only decision left on this screen is "connect".
 */
export function EmbeddedSignup({
  config,
  onConnected,
}: {
  config: SignupConfig;
  onConnected: (account: WhatsAppAccount) => void;
}) {
  const toast = useToast();
  const [sdk, setSdk] = React.useState<"loading" | "ready" | "failed">("loading");
  const [busy, setBusy] = React.useState<"dialog" | "saving" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    preloadSignupSdk().then(
      () => {
        if (active) setSdk("ready");
      },
      (reason: unknown) => {
        if (!active) return;
        setSdk("failed");
        setError(reason instanceof Error ? reason.message : "Meta's script did not load.");
      },
    );

    return () => {
      active = false;
    };
  }, []);

  const appId = config.appId;
  const configId = config.configId;
  const canStart = Boolean(appId && configId) && sdk === "ready" && busy === null;

  async function start() {
    if (!appId || !configId) return;

    setError(null);
    setBusy("dialog");

    const result = await runEmbeddedSignup({
      appId,
      configId,
      version: config.graphVersion,
    });

    if (!result.ok) {
      setBusy(null);
      setError(result.message);
      return;
    }

    setBusy("saving");

    try {
      const { account, summary } = await connectEmbeddedSignup({
        code: result.code,
        wabaId: result.wabaId,
        phoneNumberId: result.phoneNumberId,
      });

      toast.push({
        tone: "success",
        title: "WhatsApp connected",
        description: summary,
        duration: 10_000,
      });

      onConnected(account);
    } catch (failure) {
      setBusy(null);
      setError(
        failure instanceof ApiError
          ? failure.message
          : "The connection could not be saved.",
      );
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand/10">
          <Sparkles className="size-5 text-brand" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Connect in one step
            </h2>
            <span className="rounded-full bg-lime-soft px-2 py-0.5 text-[10px] font-semibold tracking-wide text-lime uppercase">
              Recommended
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Sign in to Facebook and pick your WhatsApp Business account and
            number. Meta verifies them and sends the result straight here — no
            tokens, ids or callbacks to copy.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {[
          "About a minute, and you can stop halfway without leaving anything half-connected.",
          "Meta keeps the credentials; this workspace only ever holds a reference.",
          "The connection is live the moment the window closes.",
        ].map((line) => (
          <li key={line} className="flex gap-2">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-lime"
            />
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
              {line}
            </span>
          </li>
        ))}
      </ul>

      <div className="border-t border-border pt-4">
        <Button
          className="w-full sm:w-auto"
          disabled={!canStart}
          onClick={() => void start()}
          size="lg"
          type="button"
          variant="brand"
        >
          {busy === "dialog" ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Waiting for Meta…
            </>
          ) : busy === "saving" ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Finishing…
            </>
          ) : sdk === "loading" ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Preparing…
            </>
          ) : (
            <>
              <FacebookMark className="size-4" />
              Continue with Facebook
            </>
          )}
        </Button>

        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          A Meta window opens over this page. If nothing appears, allow pop-ups
          for this site.
        </p>
      </div>

      {error ? (
        <div
          className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5"
          role="alert"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          <p className="text-[11.5px] leading-relaxed text-foreground">{error}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Meta's mark; lucide dropped brand icons, and a generic plug reads worse here. */
function FacebookMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.91h-2.33V22c4.78-.76 8.45-4.92 8.45-9.94Z" />
    </svg>
  );
}
