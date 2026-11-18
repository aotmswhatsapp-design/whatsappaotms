"use client";

import * as React from "react";
import { ChevronDown, KeyRound } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Stepper } from "@/components/ui/stepper";
import { useToast } from "@/components/ui/toast";
import { notifyWhatsAppStatus } from "@/lib/api/whatsapp-status";

import {
  ApiError,
  checkConnection,
  fetchConnection,
  fetchSignupConfig,
  type ConnectionPayload,
  type SignupConfig,
  type Verdict,
  type WhatsAppAccount,
} from "./api";
import { CheckList } from "./check-list";
import { ConnectForm } from "./connect-form";
import { EmbeddedSignup } from "./embedded-signup";
import { ErrorPanel } from "./error-panel";
import { LivePanel } from "./live-panel";
import { MetaRequirements } from "./meta-requirements";
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
  "Copy the version from the top of Meta's WhatsApp Cloud API docs, e.g. v23.0.",
  "Business settings → Accounts → WhatsApp accounts → copy the WhatsApp Account ID.",
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
  const [signup, setSignup] = React.useState<SignupConfig | null>(null);
  // Whether the answer has arrived. Until it has, the screen must not claim
  // one-click is unavailable — it simply does not know yet.
  const [signupResolved, setSignupResolved] = React.useState(false);

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

    // Whether the one-click path exists is a second, independent question. A
    // failure here must not block the credentials form, which always works.
    fetchSignupConfig()
      .then((next) => {
        if (active) setSignup(next);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setSignupResolved(true);
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

  /**
   * Embedded Signup subscribes our app before it answers, so there is no
   * handshake left to wait for: Meta's subscription is the proof, and the
   * screen goes straight to the live panel.
   */
  function handleEmbeddedConnected(next: WhatsAppAccount) {
    setPayload({ account: next, stage: "live", callbackUrl });
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

  // `current` is the stage in progress. A live connection has no stage in
  // progress, so it reports one past the end: the rail then renders all four
  // ticks and a fully lime connector instead of parking "Live" as active.
  const current =
    view === "details"
      ? 0
      : view === "waiting"
        ? 2
        : stage === "live"
          ? STEPS.length
          : stage === "webhook"
            ? 1
            : 0;

  const showingWaiting = account !== null && view === "waiting";
  const showingForm = view === "details" || (!account && stage === "details");

  // The one-click card is only offered when the API has a platform app; the
  // manual form is then a disclosure rather than the front door.
  const oneClick =
    signup?.enabled && signup.appId && signup.configId ? signup : null;

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
          <h2 className="text-base font-semibold text-foreground">
            Could not read the stored connection
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
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
            onEditDetails={() => setView("details")}
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
            onEditDetails={() => setView("details")}
            onRotated={() => void load()}
          />
        </section>
      ) : (
        <>
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            {signupResolved ? (
              <EmbeddedSignup
                config={signup}
                onConnected={handleEmbeddedConnected}
              />
            ) : (
              <p aria-live="polite" className="text-sm text-muted-foreground">
                Checking which connection methods this workspace offers…
              </p>
            )}
          </section>

          {/* The credentials path is always reachable, open by default when
              one-click cannot run, so nobody has to hunt for a way in. */}
          <Collapsible defaultOpen={!oneClick || account !== null}>
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-4 py-4 text-left sm:px-5">
                <span className="flex items-center gap-2.5 text-[15px] font-semibold text-foreground">
                  <KeyRound
                    aria-hidden="true"
                    className="size-4 text-muted-foreground"
                  />
                  I already have my own Meta app
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-border p-4 sm:p-5">
                  <ManualPanel
                    existing={account !== null}
                    onConnected={handleConnected}
                    onVerdict={setVerdict}
                    verdict={verdict}
                  />
                </div>
              </CollapsibleContent>
            </section>
          </Collapsible>

          <MetaRequirements />
        </>
      )}
    </div>
  );
}

/**
 * The credentials path: five values, checked against Meta before anything is
 * stored, plus where each one lives in Meta's console.
 *
 * It is a component rather than a variable because it is mounted twice — as
 * the only form when one-click is unavailable, and inside the disclosure when
 * it is.
 */
function ManualPanel({
  existing,
  verdict,
  onConnected,
  onVerdict,
}: {
  existing: boolean;
  verdict: Verdict | null;
  onConnected: (account: WhatsAppAccount) => void;
  onVerdict: (verdict: Verdict) => void;
}) {
  return (
    <div className="space-y-5">
      <ConnectForm
        existing={existing}
        onConnected={onConnected}
        onVerdict={onVerdict}
      />

      {verdict && !verdict.ok ? (
        <div className="rounded-lg border border-destructive/35 bg-background p-4">
          <h3 className="text-[15px] font-semibold text-foreground">
            Meta did not accept these details
          </h3>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
            {verdict.summary}
          </p>
          {verdict.checks.length ? (
            <div className="mt-3">
              <CheckList checks={verdict.checks} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="border-t border-border pt-5">
        <h3 className="text-base font-semibold text-foreground">
          Where each value comes from
        </h3>
        <ol className="mt-3 space-y-3">
          {SOURCES.map((source, index) => (
            <li key={source} className="flex gap-3">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-muted-foreground">
                {index + 1}
              </span>
              <span className="text-[13.5px] leading-relaxed text-muted-foreground">
                {source}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
