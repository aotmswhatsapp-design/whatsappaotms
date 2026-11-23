"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
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

/** How long the waiting step watches closely before dropping to a slow poll. */
const WAIT_MS = 120_000;
const POLL_MS = 3_000;
/** After the first two minutes: still watching, because a late save is common. */
const SLOW_POLL_MS = 15_000;

type View = "auto" | "details" | "waiting" | "reconnect";

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
  const [signupResolved, setSignupResolved] = React.useState(false);
  /**
   * Code exchange upserts one row per workspace, so the primary card asks
   * before it replaces a working connection.
   */
  const [replaceConfirmed, setReplaceConfirmed] = React.useState(false);

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

    // A missing or failing signup-config is not an error: it means this
    // deployment has no platform Meta app, and the screen falls back to the
    // credentials form exactly as it did before one-click existed.
    fetchSignupConfig()
      .then((next) => {
        if (active) setSignup(next);
      })
      .catch(() => {
        if (active) setSignup(null);
      })
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

      // The wait does not end at two minutes: it only slows down. A customer
      // who saves Meta's panel later must still see the screen move, and a
      // stopped screen looks like a broken one.
      const late = Date.now() - startedAt >= WAIT_MS;

      if (late) setExpired(true);

      timer = window.setTimeout(tick, late ? SLOW_POLL_MS : POLL_MS);
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
        description: account?.webhook.lastUnmatchedAt
          ? "A call arrived with a verify token that is not this workspace's — Meta still holds an earlier one."
          : "Meta has not called this endpoint yet, so the pair below is not saved in the app.",
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
    setExpired(false);
    setReplaceConfirmed(false);
    notifyWhatsAppStatus();
  }

  function handleDisconnected() {
    setPayload({ account: null, stage: "details", callbackUrl });
    setVerdict(null);
    setView("auto");
    setReplaceConfirmed(false);
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
      ) : view === "reconnect" && account ? (
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <EmbeddedSignup
            config={
              signup ?? {
                enabled: false,
                appId: null,
                configId: null,
                graphVersion: "v23.0",
              }
            }
            onConnected={handleEmbeddedConnected}
          />
          <Button
            className="mt-4"
            onClick={() => setView("auto")}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
        </section>
      ) : stage === "error" && account && view !== "details" ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <ErrorPanel
            account={account}
            checking={checking}
            onDisconnected={handleDisconnected}
            onEditCredentials={() => setView("details")}
            onReconnect={() => setView("reconnect")}
            onRecheck={recheckAgainstMeta}
          />
        </section>
      ) : showingWaiting && account ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <WaitingPanel
            callbackUrl={callbackUrl}
            webhook={account.webhook}
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
            callbackUrl={callbackUrl}
            checking={checking}
            onDisconnected={handleDisconnected}
            onReconnect={() => setView("reconnect")}
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
            <h2 className="text-base font-semibold text-foreground">
              Connect WhatsApp
            </h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
              Sign in to Meta and pick the WhatsApp Business account and number.
              Meta verifies them and reports the result straight back here, so
              there are no keys to copy.
            </p>

            <div className="mt-5">
              {account && !replaceConfirmed ? (
                <div className="rounded-lg bg-secondary px-3 py-2.5 text-[13px] leading-relaxed">
                  <p className="text-foreground">
                    This workspace is already connected to{" "}
                    {account.displayPhoneNumber ?? `ID ${account.phoneNumberId}`}.
                    Connecting again replaces its access token and webhook proof.
                    The number itself is untouched in Meta.
                  </p>
                  <Button
                    className="mt-3"
                    onClick={() => setReplaceConfirmed(true)}
                    size="sm"
                  >
                    Replace this connection
                  </Button>
                </div>
              ) : signup?.enabled && signup.appId && signup.configId ? (
                <EmbeddedSignup
                  config={signup}
                  onConnected={handleEmbeddedConnected}
                />
              ) : (
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {signupResolved
                    ? "One-click setup is not configured on this server. Use the credentials form below."
                    : "Checking whether one-click setup is available…"}
                </p>
              )}
            </div>
          </section>

          <Collapsible className="rounded-xl border border-border bg-card">
            <CollapsibleTrigger className="group flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left sm:px-5">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  I already have my own Meta app
                </span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
                  Enter the token, ids and app secret yourself. Each value is
                  checked against Graph before anything is stored.
                </span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t border-border p-4 sm:p-5">
                <CredentialsPanel
                  existing={account !== null}
                  onConnected={handleConnected}
                  onVerdict={setVerdict}
                  verdict={verdict}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <MetaRequirements />
        </>
      )}
    </div>
  );
}

/**
 * The credentials form: five values, checked against Meta before anything is
 * stored, plus where each one lives in Meta's console.
 */
function CredentialsPanel({
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
