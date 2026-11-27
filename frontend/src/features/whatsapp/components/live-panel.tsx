"use client";

import * as React from "react";
import { CircleCheck, LoaderCircle, RotateCcw, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import { ApiError, disconnectWhatsApp, type WhatsAppAccount } from "./api";
import { CoexistenceCard } from "./coexistence-card";
import { expiryDays, expiryState } from "./token-expiry";
import { WebhookFields } from "./webhook-fields";
import { when } from "./when";

/**
 * Step four: the evidence, not a tick.
 *
 * Everything here was either read from Meta or written by a request Meta made
 * to us, which is the difference between "we saved your token" and "it works".
 */
export function LivePanel({
  account,
  callbackUrl,
  checking,
  onRecheck,
  onReconnect,
  onDisconnected,
}: {
  account: WhatsAppAccount;
  /** The URL the API advertises, which outranks the one stored at connect time. */
  callbackUrl: string | null;
  checking: boolean;
  onRecheck: () => void;
  /** Runs Meta's dialog again, because an expired token cannot be refreshed. */
  onReconnect: () => void;
  onDisconnected: () => void;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const embedded = account.source === "EMBEDDED_SIGNUP";
  const state = expiryState(account.tokenExpiresAt);
  const days = expiryDays(account.tokenExpiresAt);

  const rows: [string, string][] = [
    ["Phone number", account.displayPhoneNumber ?? `ID ${account.phoneNumberId}`],
    ["Verified name", account.verifiedName ?? "—"],
    ["Quality rating", account.qualityRating ?? "—"],
    ["Business account", account.businessName ?? `ID ${account.businessAccountId}`],
    ["App ID", account.appId ?? "not stored — reconnect to add it"],
    ["Graph version", account.graphVersion],
    ["Access token", account.accessTokenHint],
    [
      "App secret",
      embedded
        ? "Held by the platform app"
        : (account.appSecretHint ?? "not stored — reconnect"),
    ],
    // Both are proof Meta will call us, but one was pasted in and the other was
    // subscribed by the API, so the label says which happened.
    [embedded ? "Meta subscription" : "Handshake", when(account.webhook.verifiedAt)],
    ["Last delivery", when(account.webhook.lastEventAt)],
    ["Deliveries", String(account.webhook.eventCount)],
    [
      "Token expires",
      days === null
        ? "Never expires"
        : state === "expired"
          ? "Expired — reconnect"
          : `in ${days} ${days === 1 ? "day" : "days"}`,
    ],
  ];

  async function disconnect() {
    setPending(true);

    try {
      await disconnectWhatsApp();
      onDisconnected();
      toast.push({
        tone: "info",
        title: "Number disconnected",
        description:
          "The stored credentials were deleted. Its chat history is kept, and connecting this number again brings it back.",
      });
    } catch (error) {
      toast.push({
        tone: "error",
        title: "Could not disconnect",
        description:
          error instanceof ApiError ? error.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-lime-soft">
          <CircleCheck className="size-5 text-lime" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">WhatsApp is live</h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
            Meta accepted the credentials, verified the callback URL with our
            token, and is delivering events. The sidebar dot stays green from
            here.
          </p>
        </div>
      </div>

      <dl className="space-y-2.5 text-sm">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-start justify-between gap-3 border-b border-border/70 pb-2.5 last:border-0 last:pb-0"
          >
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium break-all text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      {account.onBizApp ? <CoexistenceCard sync={account.sync} /> : null}

      {state === "soon" || state === "expired" ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[13px] leading-relaxed">
          <p className="font-medium text-foreground">
            {state === "expired"
              ? "The access token has expired. Sending is paused until you reconnect."
              : `The access token expires in ${days} ${days === 1 ? "day" : "days"}.`}
          </p>
          <p className="mt-1 text-muted-foreground">
            Meta tokens cannot be refreshed silently — reconnect through Meta to
            issue a new one. The number and its history stay as they are.
          </p>
          <Button className="mt-3" onClick={onReconnect} size="sm">
            Reconnect
          </Button>
        </div>
      ) : null}

      <WebhookFields
        callbackUrl={callbackUrl ?? account.webhook.callbackUrl}
        platform={embedded}
        verifyToken={account.webhook.verifyToken}
      />

      {account.webhook.eventCount === 0 ? (
        <p className="rounded-lg bg-secondary px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
          No deliveries yet. The counter moves the first time a message reaches
          the number — send one from any phone to watch it happen.
        </p>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
        <Button className="w-full sm:w-auto" disabled={checking} onClick={onRecheck} size="lg" variant="outline">
          {checking ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw aria-hidden="true" />
          )}
          Re-check against Meta
        </Button>

        {confirming ? (
          <>
            <Button disabled={pending} onClick={disconnect} size="lg" variant="destructive">
              {pending ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Unplug aria-hidden="true" />
              )}
              Yes, disconnect
            </Button>
            <Button
              className="w-full sm:w-auto"
              disabled={pending}
              onClick={() => setConfirming(false)}
              size="lg"
              variant="ghost"
            >
              Keep it
            </Button>
          </>
        ) : (
          <Button
            className="w-full sm:w-auto"
            onClick={() => setConfirming(true)}
            size="lg"
            variant="ghost"
          >
            <Unplug aria-hidden="true" />
            Disconnect
          </Button>
        )}
      </div>

      {confirming ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Disconnecting deletes the token, the app secret and the webhook
          proof. Its conversations stay in the Inbox, and connecting this number
          again brings them back. Meta keeps posting to the URL until you remove
          it in the Webhooks panel of the app; those deliveries are ignored.
        </p>
      ) : null}
    </div>
  );
}
