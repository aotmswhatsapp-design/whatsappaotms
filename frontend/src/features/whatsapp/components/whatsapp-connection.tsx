"use client";

import * as React from "react";
import { CircleCheck, CircleX } from "lucide-react";

import { Stepper } from "@/components/ui/stepper";
import { cn } from "@/lib/utils";

import { ApiError, fetchConnection, type Verdict, type WhatsAppAccount } from "./api";
import { CheckList } from "./check-list";
import { ConnectForm } from "./connect-form";
import { ConnectionCard } from "./connection-card";

// Short labels: three stages have to fit on a 390px screen without eliding.
const STEPS = [
  { id: "details", label: "Details" },
  { id: "verified", label: "Verified" },
  { id: "connected", label: "Connected" },
];

const SOURCES = [
  "Meta Business settings → Users → System users → generate a token with whatsapp_business_messaging.",
  "WhatsApp Manager → Phone numbers → copy the numeric ID under the display number.",
  "Invent any 8–128 character string; the same value goes into Meta's webhook setup.",
  "Copy the version from the top of Meta's WhatsApp Cloud API docs, e.g. v21.0.",
  "Business settings → Accounts → WhatsApp accounts → copy the WhatsApp Business Account ID.",
];

/**
 * The page's client boundary. It owns the server state (the stored connection)
 * and the last verdict; the form owns the draft values.
 */
export function WhatsAppConnection() {
  const [account, setAccount] = React.useState<WhatsAppAccount | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [verdict, setVerdict] = React.useState<Verdict | null>(null);

  React.useEffect(() => {
    let active = true;

    fetchConnection()
      .then((result) => {
        if (active) setAccount(result.account);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(
          error instanceof ApiError
            ? error.message
            : "Could not read the stored connection.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // A stored connection means every stage is behind us — including the last.
  const current = account ? STEPS.length : 0;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card px-4 py-3 sm:px-5">
        <Stepper current={current} steps={STEPS} />
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="rounded-xl border border-border bg-card p-5">
          <ConnectForm
            onConnected={(next) => {
              setAccount(next);
              setLoadError(null);
            }}
            onVerdict={setVerdict}
          />
        </section>

        <div className="space-y-4">
          <ConnectionCard
            account={account}
            loadError={loadError}
            loading={loading}
            onDisconnected={() => {
              setAccount(null);
              setVerdict(null);
            }}
          />

          {verdict ? (
            <section
              className={cn(
                "rounded-xl border bg-card p-5",
                verdict.ok ? "border-lime/35" : "border-destructive/35",
              )}
            >
              <div className="flex items-start gap-2.5">
                {verdict.ok ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-lime" aria-hidden="true" />
                ) : (
                  <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground">
                    {verdict.ok ? "Meta accepted the connection" : "Meta did not accept it"}
                  </h2>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    {verdict.summary}
                  </p>
                </div>
              </div>

              {verdict.checks.length ? (
                <div className="mt-4">
                  <CheckList checks={verdict.checks} />
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">
              Where each value comes from
            </h2>
            <ol className="mt-3 space-y-3">
              {SOURCES.map((source, index) => (
                <li key={source} className="flex gap-2.5">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-secondary text-[9px] font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                    {source}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
