"use client";

import * as React from "react";
import { LoaderCircle, Lock, ShieldCheck, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { ApiError, disconnectWhatsApp, type WhatsAppAccount } from "./api";

function when(iso: string | null): string {
  if (!iso) return "—";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/**
 * What the API currently holds. Separate from the form because it survives a
 * reload: the connection lives on the server, not in this component.
 */
export function ConnectionCard({
  account,
  loading,
  loadError,
  onDisconnected,
}: {
  account: WhatsAppAccount | null;
  loading: boolean;
  loadError: string | null;
  onDisconnected: () => void;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function handleDisconnect() {
    setPending(true);

    try {
      await disconnectWhatsApp();
      onDisconnected();
      setConfirming(false);
      toast.push({
        tone: "info",
        title: "Connection removed",
        description: "The stored token and number were deleted from the API.",
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

  const rows = account
    ? [
        [
          "Business account",
          account.businessName ?? `ID ${account.businessAccountId}`,
        ],
        [
          "Phone number",
          account.displayPhoneNumber ?? `ID ${account.phoneNumberId}`,
        ],
        ["Verified name", account.verifiedName ?? "—"],
        ["Graph version", account.graphVersion],
        ["Access token", account.accessTokenHint],
        ["Verify token", account.verifyTokenHint],
        ["Verified at", when(account.lastVerifiedAt)],
      ]
    : [];

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Stored connection</h2>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
            account
              ? "bg-lime-soft text-lime"
              : "bg-secondary text-muted-foreground",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              account ? "bg-lime" : "bg-muted-foreground",
            )}
          />
          {account ? "Connected" : "Not connected"}
        </span>
      </div>

      {loading ? (
        <div className="mt-4 space-y-2" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="h-5 animate-pulse rounded bg-secondary"
              style={{ width: `${60 + row * 12}%` }}
            />
          ))}
        </div>
      ) : account ? (
        <>
          <dl className="mt-4 space-y-2 text-xs">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="flex items-start justify-between gap-3 border-b border-border/70 pb-2 last:border-0 last:pb-0"
              >
                <dt className="shrink-0 text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium break-all text-foreground">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 flex items-start gap-2 rounded-lg bg-lime-soft px-3 py-2 text-[11px] leading-relaxed text-lime">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Secrets are encrypted at rest and never return to the browser —
              only these last-four hints do.
            </span>
          </p>

          <div className="mt-4 flex items-center gap-2">
            {confirming ? (
              <>
                <Button
                  disabled={pending}
                  onClick={handleDisconnect}
                  size="sm"
                  variant="destructive"
                >
                  {pending ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Unplug aria-hidden="true" />
                  )}
                  Yes, disconnect
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => setConfirming(false)}
                  size="sm"
                  variant="ghost"
                >
                  Keep it
                </Button>
              </>
            ) : (
              <Button onClick={() => setConfirming(true)} size="sm" variant="outline">
                <Unplug aria-hidden="true" />
                Disconnect
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
            {loadError ??
              "No credentials are stored for this account. Fill the five details and confirm — they appear here once Meta verifies them."}
          </p>
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-secondary px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Nothing is written until every check passes, so a rejected token
              never reaches the database.
            </span>
          </p>
        </>
      )}
    </section>
  );
}
