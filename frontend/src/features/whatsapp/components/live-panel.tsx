"use client";

import * as React from "react";
import { CircleCheck, LoaderCircle, RotateCcw, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import { ApiError, disconnectWhatsApp, type WhatsAppAccount } from "./api";
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
  onDisconnected,
}: {
  account: WhatsAppAccount;
  /** The URL the API advertises, which outranks the one stored at connect time. */
  callbackUrl: string | null;
  checking: boolean;
  onRecheck: () => void;
  onDisconnected: () => void;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const rows: [string, string][] = [
    ["Phone number", account.displayPhoneNumber ?? `ID ${account.phoneNumberId}`],
    ["Verified name", account.verifiedName ?? "—"],
    ["Quality rating", account.qualityRating ?? "—"],
    ["Business account", account.businessName ?? `ID ${account.businessAccountId}`],
    ["App ID", account.appId ?? "not stored — reconnect to add it"],
    ["Graph version", account.graphVersion],
    ["Access token", account.accessTokenHint],
    ["App secret", account.appSecretHint ?? "not stored — reconnect"],
    ["Handshake", when(account.webhook.verifiedAt)],
    ["Last delivery", when(account.webhook.lastEventAt)],
    ["Deliveries", String(account.webhook.eventCount)],
  ];

  async function disconnect() {
    setPending(true);

    try {
      await disconnectWhatsApp();
      onDisconnected();
      toast.push({
        tone: "info",
        title: "Connection removed",
        description: "The stored credentials and webhook proof were deleted.",
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

      <WebhookFields
        callbackUrl={callbackUrl ?? account.webhook.callbackUrl}
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
          Disconnecting deletes the token, the app secret and the webhook proof.
          Meta keeps posting to the URL until you remove it in the Webhooks
          panel of the app; those deliveries are ignored.
        </p>
      ) : null}
    </div>
  );
}
