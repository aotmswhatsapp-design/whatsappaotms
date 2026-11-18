"use client";

import { ArrowLeft, LoaderCircle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Step three: the wait, made legible.
 *
 * Nothing on this screen calls Meta — it watches the row Meta's handshake
 * writes to. That is why "Check again" is instant and why the answer arrives on
 * its own the moment Meta calls.
 */
export function WaitingPanel({
  callbackUrl,
  expired,
  checking,
  onCheck,
  onBack,
}: {
  callbackUrl: string | null;
  expired: boolean;
  checking: boolean;
  onCheck: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft">
          <LoaderCircle className="size-5 animate-spin text-brand" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            Waiting for the handshake from Meta
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            When you pressed <span className="font-medium text-foreground">Verify and save</span>,
            Meta called this API. The moment that call arrives, this page moves
            on by itself — you do not need to refresh.
          </p>
        </div>
      </div>

      <dl className="rounded-lg bg-secondary px-3.5 py-3">
        <dt className="text-[11px] font-medium text-muted-foreground">Meta is calling</dt>
        <dd className="mt-1 font-mono text-[12px] break-all text-foreground">
          {callbackUrl ?? "No callback URL configured — Meta has nowhere to call."}
        </dd>
      </dl>

      {expired ? (
        <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-[11.5px] leading-relaxed text-warning">
          Nothing has arrived after two minutes. The wait has stopped; check the
          three usual causes below, then try again.
        </p>
      ) : (
        <p aria-live="polite" className="text-[11px] text-muted-foreground">
          Watching for it. This screen keeps checking for two minutes.
        </p>
      )}

      <div>
        <h3 className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          If it never arrives
        </h3>
        <ul className="mt-2 space-y-2">
          <li className="text-[11.5px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">The URL differs.</span>{" "}
            Meta still holds an older callback URL, or the app has no webhook URL
            saved at all.
          </li>
          <li className="text-[11.5px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">The token differs.</span>{" "}
            If this page issued a new verify token, Meta is still echoing the
            previous one — paste the current token there.
          </li>
          <li className="text-[11.5px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">It was blocked.</span>{" "}
            A firewall, or an API that was asleep, can drop the request before it
            is handled. Press Verify and save in Meta again.
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
        <Button className="w-full sm:w-auto" disabled={checking} onClick={onCheck} size="lg" variant="brand">
          {checking ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw aria-hidden="true" />
          )}
          Check again
        </Button>
        <Button className="w-full sm:w-auto" onClick={onBack} size="lg" variant="ghost">
          <ArrowLeft aria-hidden="true" />
          Back to the values
        </Button>
      </div>
    </div>
  );
}
