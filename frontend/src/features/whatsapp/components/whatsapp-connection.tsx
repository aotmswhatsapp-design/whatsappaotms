"use client";

import * as React from "react";

import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import { notifyWhatsAppStatus } from "@/lib/api/whatsapp-status";

import {
  ApiError,
  checkConnection,
  fetchConnection,
  type ConnectionPayload,
  type Verdict,
  type WhatsAppAccount,
} from "./api";
import { CheckList } from "./check-list";
import { ConnectForm } from "./connect-form";
import { ErrorPanel } from "./error-panel";
import { LivePanel } from "./live-panel";
import { WaitingPanel } from "./waiting-panel";
import { WebhookPanel } from "./webhook-panel";

// Short labels: four stages have to fit on a 390px screen without eliding.
const STEPS = [
  { id: "details", label: "Details" },
  { id: "webhook", label: "Webhook" },
  { id: "waiting", label: "Waiting" },
  { id: "live", label: "Live" },
];

const SOURCES = [
  "Meta Business settings → Users → System users → generate a token with whatsapp_business_messaging.",
  "WhatsApp Manager → Phone numbers → copy the numeric ID under the display number.",
  "App settings → Basic → App secret → Show. It signs every webhook delivery.",
  "Copy the version from the top of Meta's WhatsApp Cloud API docs, e.g. v21.0.",
  "Business settings → Accounts → WhatsApp accounts → copy the WhatsApp Business Account ID.",
];

/** How long the waiting step watches for Meta before it gives up and explains. */
const WAIT_MS = 120_000;
const POLL_MS = 3_000;

type View = "auto" | "details" | "waiting";

function readError(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Could not read the stored connection.";
}

/**
 * The page's client boundary. It owns the server state (the stored connection)
 * and the step the customer is on; each panel owns its own form state.
 *
 * The waiting step polls our own row, not Meta: the handshake *is* the answer,
 * so a delivery from Meta moves this screen the moment it lands.
 */
export function WhatsAppConnection() {
  const toast = useToast();
  const [payload, setPayload] = React.useState<ConnectionPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [verdict, setVerdict] = React.useState<Verdict | null>(null);
  const [view, setView] = React.useState<View>("auto");
  const [expired, setExpired] = React.useState(false);
  const [checking, setChecking] = React.useState(false);

  const load = React.useCallback(async (): Promise<ConnectionPayload | null> => {
    try {
      const next = await fetchConnection();
      setPayload(next);
      setLoadError(null);
      return next;
    } catch (error) {
      setLoadError(readError(error));
      return null;
    }
  }, []);

  // The first read is inline rather than through `load` so the state updates
  // stay in the promise callbacks instead of the effect body.
  React.useEffect(() => {
    let active = true;

    fetchConnection()
      .then((next) => {
        if (!active) return;
        setPayload(next);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(readError(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const account = payload?.account ?? null;
  const stage = payload?.stage ?? "details";
  const callbackUrl = payload?.callbackUrl ?? null;

  // A handshake that lands while this tab is open ends the wait on its own.
  React.useEffect(() => {
    if (view !== "waiting") return;

    let active = true;
    const startedAt = Date.now();
    let timer = 0;

    const tick = async () => {
      if (!active) return;

      const next = await load();

      if (!active) return;

      if (next && next.stage !== "webhook") {
        setView("auto");
        notifyWhatsAppStatus();
        return;
      }

      if (Date.now() - startedAt >= WAIT_MS) {
        setExpired(true);
        return;
      }

      timer = window.setTimeout(tick, POLL_MS);
    };

    timer = window.setTimeout(tick, POLL_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [view, load]);

  /** Re-reads our own row. Instant, because it never leaves the API. */
  async function checkForHandshake() {
    setChecking(true);
    const next = await load();
    setChecking(false);

    if (next && next.stage !== "webhook") {
      setView("auto");
      notifyWhatsAppStatus();
    } else {
      toast.push({
        tone: "info",
        title: "Still waiting",
        description:
          "Meta has not called the callback URL yet. The three causes below usually explain it.",
      });
    }
  }

  /** Asks Graph again. Used once a connection exists and something looks wrong. */
  async function recheckAgainstMeta() {
    setChecking(true);

    try {
      const status = await checkConnection();

      if (status.state === "live") {
        toast.push({
          tone: "success",
          title: "Meta still accepts these credentials",
          description: "Nothing has changed on the API side.",
        });
      } else if (status.state === "error") {
        toast.push({
          tone: "error",
          title: "Meta rejected the stored credentials",
          description: status.reason ?? "Update the credentials to reconnect.",
          duration: 0,
        });
      }

      // The verdict changed one way or the other, so the sidebar dot must
      // follow even when the request only proved the credentials are dead.
      await load();
      setView("auto");
      notifyWhatsAppStatus();
    } catch (error) {
      toast.push({
        tone: "error",
        title: "Could not reach Meta",
        description:
          error instanceof ApiError ? error.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setChecking(false);
    }
  }

  function handleConnected(next: WhatsAppAccount) {
    setPayload({ account: next, stage: "webhook", callbackUrl });
    setVerdict(null);
    setView("auto");
    notifyWhatsAppStatus();
  }

  function handleDisconnected() {
    setPayload({ account: null, stage: "details", callbackUrl });
    setVerdict(null);
    setView("auto");
    notifyWhatsAppStatus();
  }

  const current =
    view === "details"
      ? 0
      : view === "waiting"
        ? 2
        : stage === "live"
          ? 3
          : stage === "webhook"
            ? 1
            : 0;

  const showingWaiting = account !== null && view === "waiting";
  const showingForm = view === "details" || (!account && stage === "details");

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card px-4 py-3 sm:px-5">
        <Stepper
          current={current}
          onStepClick={(index) => {
            if (index === 0) setView("details");
            if (index === 1 && account) setView("auto");
          }}
          steps={STEPS}
        />
      </section>

      {loading ? (
        <section className="rounded-xl border border-border bg-card p-5" aria-busy="true">
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="h-5 animate-pulse rounded bg-secondary"
                style={{ width: `${55 + row * 11}%` }}
              />
            ))}
          </div>
        </section>
      ) : loadError && !account ? (
        <section className="rounded-xl border border-destructive/30 bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">
            Could not read the stored connection
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {loadError}
          </p>
        </section>
      ) : stage === "error" && account && view !== "details" ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <ErrorPanel
            account={account}
            checking={checking}
            onDisconnected={handleDisconnected}
            onEditCredentials={() => setView("details")}
            onRecheck={recheckAgainstMeta}
          />
        </section>
      ) : showingWaiting && account ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <WaitingPanel
            callbackUrl={callbackUrl}
            checking={checking}
            expired={expired}
            onBack={() => setView("auto")}
            onCheck={checkForHandshake}
          />
        </section>
      ) : stage === "live" && account && !showingForm ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <LivePanel
            account={account}
            checking={checking}
            onDisconnected={handleDisconnected}
            onRecheck={recheckAgainstMeta}
          />
        </section>
      ) : account && !showingForm ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <WebhookPanel
            account={account}
            callbackUrl={callbackUrl}
            onContinue={() => {
              setExpired(false);
              setView("waiting");
            }}
            onRotated={() => void load()}
          />
        </section>
      ) : (
        <>
          <section className="rounded-xl border border-border bg-card p-5">
            <ConnectForm
              existing={account !== null}
              onConnected={handleConnected}
              onVerdict={setVerdict}
            />
          </section>

          {verdict && !verdict.ok ? (
            <section className="rounded-xl border border-destructive/35 bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground">
                Meta did not accept these details
              </h2>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {verdict.summary}
              </p>
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
        </>
      )}
    </div>
  );
}
