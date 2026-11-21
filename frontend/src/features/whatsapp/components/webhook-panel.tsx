"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, LoaderCircle, PlugZap, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { ApiError, rotateVerifyToken, type WhatsAppAccount } from "./api";
import { WebhookFields } from "./webhook-fields";

const STEPS = [
  "Open developers.facebook.com, pick the app that owns this number, then WhatsApp → Configuration.",
  "Next to Webhook, click Edit.",
  "Paste the callback URL and the verify token above, then click Verify and save.",
  "Under Webhook fields, subscribe to the messages field — that is the event this API counts.",
  "Come back here and press Continue.",
];

/**
 * Step two: the two values Meta's console asks for.
 *
 * The verify token is shown in full on purpose. It is a shared secret between
 * us and Meta's configuration — it grants no access to the number — and a token
 * the customer cannot read is a token they cannot install.
 */
export function WebhookPanel({
  account,
  callbackUrl,
  onRotated,
  onContinue,
  onEditDetails,
}: {
  account: WhatsAppAccount;
  callbackUrl: string | null;
  onRotated: () => void;
  onContinue: () => void;
  /** Returns to the credential form, so a wrong value never traps the flow. */
  onEditDetails: () => void;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const url = callbackUrl ?? account.webhook.callbackUrl;

  async function rotate() {
    setPending(true);

    try {
      const result = await rotateVerifyToken();

      if (!result.rotated) {
        toast.push({
          tone: "error",
          title: "Nothing to rotate",
          description: "The stored connection disappeared. Reload the page.",
          duration: 0,
        });
        return;
      }

      setConfirming(false);
      onRotated();
      toast.push({
        tone: "info",
        title: "New verify token issued",
        description: "Paste it into Meta again — the old one no longer matches.",
      });
    } catch (error) {
      toast.push({
        tone: "error",
        title: "Could not rotate the token",
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
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <PlugZap className="size-4 text-brand" aria-hidden="true" />
          Point Meta at this API
        </h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
          {account.displayPhoneNumber ?? account.phoneNumberId} is accepted.
          Meta will not send a single event until these two values are saved in
          the Webhooks panel of that app.
        </p>
      </div>

      <div className="space-y-4">
        <WebhookFields
          callbackUrl={url}
          verifyToken={account.webhook.verifyToken}
        />

        {url ? null : (
          <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] leading-relaxed text-warning">
            This API has no public webhook URL configured, so Meta has nowhere to
            call. Set <code className="font-mono">WHATSAPP_WEBHOOK_PUBLIC_URL</code>{" "}
            on the API to <code className="font-mono">https://&lt;api-host&gt;/api/v1/whatsapp/webhook</code>{" "}
            and reload this page.
          </p>
        )}
      </div>

      <ol className="space-y-3 rounded-lg bg-secondary px-4 py-3.5">
        {STEPS.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-card text-[11px] font-semibold text-muted-foreground">
              {index + 1}
            </span>
            <span className="text-[13.5px] leading-relaxed text-muted-foreground">
              {step}
            </span>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
        <Button className="w-full sm:w-auto" disabled={pending} onClick={onContinue} size="lg" variant="brand">
          I have saved it
          <ArrowRight aria-hidden="true" />
        </Button>

        {confirming ? (
          <>
            <Button disabled={pending} onClick={rotate} size="lg" variant="destructive">
              {pending ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw aria-hidden="true" />
              )}
              Replace the token
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
            className={cn("w-full sm:w-auto")}
            disabled={pending}
            onClick={() => setConfirming(true)}
            size="lg"
            variant="ghost"
          >
            <RotateCcw aria-hidden="true" />
            Rotate the token
          </Button>
        )}

        <Button
          className="w-full sm:w-auto"
          onClick={onEditDetails}
          size="lg"
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" />
          Back to the details
        </Button>
      </div>

      {confirming ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Rotating means the token already pasted into Meta stops matching, and
          this connection goes back to waiting until you paste the new one there.
        </p>
      ) : null}
    </div>
  );
}
