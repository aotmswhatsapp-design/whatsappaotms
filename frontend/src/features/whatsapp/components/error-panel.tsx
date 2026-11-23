"use client";

import * as React from "react";
import { CircleX, LoaderCircle, RotateCcw, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import { ApiError, disconnectWhatsApp, type WhatsAppAccount } from "./api";
import { when } from "./when";

/**
 * The red state. It exists because a stored token can stop working without
 * anyone touching this app: revoked in Meta, an expired system user, a deleted
 * number. Saying so is the whole point — a green dot on a dead number is worse
 * than no dot at all.
 */
export function ErrorPanel({
  account,
  checking,
  onRecheck,
  onEditCredentials,
  onReconnect,
  onDisconnected,
}: {
  account: WhatsAppAccount;
  checking: boolean;
  onRecheck: () => void;
  onEditCredentials: () => void;
  /** Runs Meta's dialog again; platform tokens cannot be edited by hand. */
  onReconnect: () => void;
  onDisconnected: () => void;
}) {
  const toast = useToast();
  const [pending, setPending] = React.useState(false);

  const embedded = account.source === "EMBEDDED_SIGNUP";

  async function disconnect() {
    setPending(true);

    try {
      await disconnectWhatsApp();
      onDisconnected();
      toast.push({
        tone: "info",
        title: "Connection removed",
        description: "The stored credentials were deleted.",
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
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-destructive/10">
          <CircleX className="size-5 text-destructive" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">
            Meta no longer accepts these credentials
          </h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Last checked {when(account.lastCheckAt)}
          </p>
        </div>
      </div>

      <p className="rounded-lg border border-destructive/30 bg-card px-3.5 py-3 text-sm leading-relaxed text-foreground">
        {account.failureReason ??
          "The stored access token was refused. Nothing was deleted — update the credentials and the connection comes back."}
      </p>

      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        {embedded
          ? "This does not delete anything. Meta issued this connection's token, so the way back is to reconnect through Meta — an expired token cannot be extended by hand."
          : "This does not delete anything. If the token was revoked in Meta, generate a new system-user token and paste it below; if the number changed, use the new phone number ID too."}
      </p>

      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
        <Button className="w-full sm:w-auto" disabled={checking} onClick={onRecheck} size="lg" variant="brand">
          {checking ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw aria-hidden="true" />
          )}
          Check again
        </Button>
        {embedded ? (
          <Button
            className="w-full sm:w-auto"
            onClick={onReconnect}
            size="lg"
            variant="outline"
          >
            Reconnect
          </Button>
        ) : (
          <Button
            className="w-full sm:w-auto"
            onClick={onEditCredentials}
            size="lg"
            variant="outline"
          >
            Update credentials
          </Button>
        )}
        <Button
          className="w-full sm:w-auto"
          disabled={pending}
          onClick={disconnect}
          size="lg"
          variant="ghost"
        >
          {pending ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Unplug aria-hidden="true" />
          )}
          Disconnect
        </Button>
      </div>
    </div>
  );
}
