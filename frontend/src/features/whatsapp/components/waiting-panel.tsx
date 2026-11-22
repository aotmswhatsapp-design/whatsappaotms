"use client";

import { ArrowLeft, CircleAlert, KeyRound, LoaderCircle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { WebhookFacts } from "./api";
import { WebhookFields } from "./webhook-fields";

/**
 * Step three: the wait, made legible.
 *
 * Nothing on this screen calls Meta — it watches what Meta's calls left behind.
 * The API records every handshake attempt, matched or not, so this screen can
 * say which of two very different things is true: no call has arrived at all
 * (nothing is saved in Meta), or a call arrived with a token that is not ours
 * (Meta still holds an older one). Without that trace the two look identical,
 * and the only thing left to say is "wait".
 */
export function WaitingPanel({
  callbackUrl,
  webhook,
  expired,
  checking,
  onCheck,
  onBack,
  onEditDetails,
}: {
  callbackUrl: string | null;
  webhook: WebhookFacts;
  expired: boolean;
  checking: boolean;
  onCheck: () => void;
  onBack: () => void;
  /** Returns to the credential form — the fix for a wrong number or token. */
  onEditDetails: () => void;
}) {
  const reached = webhook.lastAttemptAt !== null;
  const foreign = !reached && webhook.lastUnmatchedAt !== null;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft">
          <LoaderCircle className="size-5 animate-spin text-brand" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">
            {foreign
              ? "Meta called with a different verify token"
              : "Waiting for the handshake from Meta"}
          </h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
            {foreign ? (
              <>
                A call arrived {clock(webhook.lastUnmatchedAt)} and presented a
                token ending{" "}
                <span className="font-mono font-medium text-foreground">
                  {webhook.lastUnmatchedHint ?? "????"}
                </span>
                , which is not this workspace&apos;s. Meta is still echoing an
                earlier token — copy the current one below into Meta and save it
                again.
              </>
            ) : (
              <>
                Nothing has reached this endpoint yet. Meta only calls it when
                someone presses <span className="font-medium text-foreground">Verify and save</span>{" "}
                in the app&apos;s webhook settings, so the two values below are
                not saved there yet. This page moves on by itself the moment a
                call lands.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[12.5px] font-medium text-muted-foreground">
          Meta is calling
        </p>
        <WebhookFields callbackUrl={callbackUrl} verifyToken={webhook.verifyToken} />
      </div>

      {foreign ? (
        <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] leading-relaxed text-warning">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            The token this workspace holds ends{" "}
            <span className="font-mono font-medium">
              {tailOf(webhook.verifyToken)}
            </span>
            . If you never saved a token that ends in {" "}
            <span className="font-mono font-medium">
              {webhook.lastUnmatchedHint ?? "????"}
            </span>
            , it belongs to another customer of this API — rotating this
            workspace&apos;s token cannot change it.
          </span>
        </p>
      ) : expired ? (
        <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] leading-relaxed text-warning">
          Nothing has arrived after two minutes. The screen is still watching,
          just less often — if Meta calls later it will move on by itself.
        </p>
      ) : (
        <p aria-live="polite" className="text-[12.5px] text-muted-foreground">
          Watching for it. This screen keeps checking for two minutes, then every
          fifteen seconds.
        </p>
      )}

      <div>
        <h3 className="text-[12px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          If it never arrives
        </h3>
        <ul className="mt-2 space-y-2.5">
          <li className="text-[13.5px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">The URL differs.</span>{" "}
            Meta still holds an older callback URL, or the app has no webhook URL
            saved at all.
          </li>
          <li className="text-[13.5px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">The token differs.</span>{" "}
            If this page issued a new verify token, Meta is still echoing the
            previous one — paste the current token there.
          </li>
          <li className="text-[13.5px] leading-relaxed text-muted-foreground">
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
        <Button className="w-full sm:w-auto" onClick={onEditDetails} size="lg" variant="outline">
          <KeyRound aria-hidden="true" />
          Back to the details
        </Button>
        <Button className="w-full sm:w-auto" onClick={onBack} size="lg" variant="ghost">
          <ArrowLeft aria-hidden="true" />
          Back to the webhook step
        </Button>
      </div>
    </div>
  );
}

/** A timestamp the customer can hold against their own clock. */
function clock(iso: string | null): string {
  if (!iso) return "a moment ago";

  const at = new Date(iso);

  if (Number.isNaN(at.getTime())) return "a moment ago";

  return at.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** The four characters the API keeps, for comparing two tokens on screen. */
function tailOf(token: string | null): string {
  if (!token) return "????";

  return token.length <= 4 ? token : token.slice(-4);
}
