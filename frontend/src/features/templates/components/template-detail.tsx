"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCheck,
  CircleAlert,
  Eye,
  Loader2,
  MessageCircle,
  MousePointerClick,
  RefreshCw,
  Send,
  Sparkles,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  CHART_COLORS,
  KpiTile,
  MultiTrendCard,
} from "@/components/workspace/dashboard/charts";
import { cn } from "@/lib/utils";

import {
  ApiError,
  enableTemplateInsights,
  fetchTemplate,
  fetchTemplateAnalytics,
  type TemplateAnalytics,
  type TemplateFacts,
} from "../api";
import { categoryLabel, statusLabel, statusTone, updatedLabel } from "../format";
import { languageLabel } from "../languages";
import { TemplateCard } from "./template-card";

/** Meta serves ninety days; these are the windows worth offering. */
const WINDOWS = [7, 30, 90] as const;
type WindowDays = (typeof WINDOWS)[number];

const TONES: Record<string, string> = {
  ok: "border-lime/45 bg-lime/10 text-foreground",
  waiting: "border-warning/45 bg-warning/10 text-foreground",
  bad: "border-destructive/35 bg-destructive/10 text-foreground",
  muted: "border-border bg-secondary text-muted-foreground",
};

/**
 * One template, opened.
 *
 * The left half is the message as it was approved — the same card the list
 * shows, because that is what the numbers on the right are numbers *about*.
 * The right half is money, then volume, then the shape of the window.
 *
 * Meta's numbers are the authority for performance and cost. Unique replies
 * are counted from this workspace's own message log, because Meta publishes no
 * replies metric at all — and a failed Meta read keeps them on screen rather
 * than replacing the page with an error.
 */
export function TemplateDetail({ id }: { id: string }) {
  const toast = useToast();
  const [facts, setFacts] = React.useState<TemplateFacts | null>(null);
  const [stats, setStats] = React.useState<TemplateAnalytics | null>(null);
  const [days, setDays] = React.useState<WindowDays>(30);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    Promise.all([fetchTemplate(id), fetchTemplateAnalytics(id, days)])
      .then(([row, read]) => {
        if (!active) return;

        setFacts(row);
        setStats(read);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;

        setError(readReason(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, days, attempt]);

  async function turnOnInsights() {
    setBusy(true);

    try {
      await enableTemplateInsights();

      setConfirming(false);
      setStats((current) =>
        current ? { ...current, insightsEnabled: true } : current,
      );
      // The first numbers appear at the next daily rollup, so re-reading now
      // would only prove the switch was accepted.
      setAttempt((count) => count + 1);

      toast.push({
        tone: "success",
        title: "Insights are on",
        description:
          "Meta now records this template's performance for the whole number. Numbers appear from the next daily rollup.",
      });
    } catch (caught) {
      toast.push({
        tone: "error",
        title: "Meta refused the switch",
        description: readReason(caught),
        duration: 0,
      });
    } finally {
      setBusy(false);
    }
  }

  if (!facts) {
    return (
      <div className="space-y-4">
        <BackLink />
        {loading ? (
          <div className="grid h-64 place-items-center rounded-xl border border-border bg-card">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-sm font-semibold text-foreground">
              This template could not be read
            </h2>
            <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              {error ?? "The request failed."}
            </p>
            <Button
              className="mt-4"
              onClick={() => {
                setLoading(true);
                setAttempt((count) => count + 1);
              }}
              type="button"
              variant="outline"
            >
              <RefreshCw />
              Try again
            </Button>
          </div>
        )}
      </div>
    );
  }

  const tone = statusTone(facts.status);
  const money = (value: number | null) => moneyLabel(value, stats?.currency ?? null);
  const performance = stats?.performance;
  const watched = new Set(stats?.unavailable ?? []);

  const lines = [
    {
      label: "Sent",
      color: CHART_COLORS.brand,
      points: countSeries(stats, (day) => day.sent),
    },
    {
      label: "Delivered",
      color: CHART_COLORS.blue,
      points: countSeries(stats, (day) => day.delivered),
    },
    {
      label: "Read",
      color: CHART_COLORS.lime,
      points: countSeries(stats, (day) => day.read),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackLink />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-semibold tracking-[-0.01em] text-foreground">
                {facts.name}
              </h1>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap",
                  TONES[tone],
                )}
              >
                {statusLabel(facts.status)}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {categoryLabel(facts.category)} · {languageLabel(facts.language)} ·
              updated {updatedLabel(facts.updatedAt)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div
              aria-label="Reporting window"
              className="flex rounded-lg border border-border bg-card p-0.5"
              role="group"
            >
              {WINDOWS.map((value) => (
                <button
                  aria-pressed={days === value}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
                    days === value
                      ? "bg-secondary text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  key={value}
                  onClick={() => {
                    if (value === days) return;

                    // The old numbers stay on screen until the new window
                    // answers; the spinner is the only thing that moves.
                    setLoading(true);
                    setDays(value);
                  }}
                  type="button"
                >
                  {value}d
                </button>
              ))}
            </div>
            <Button
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setAttempt((count) => count + 1);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCw className={cn(loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <p
          className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12.5px] leading-relaxed text-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <aside className="space-y-3">
          <ul>
            <TemplateCard row={facts} />
          </ul>

          <dl className="rounded-xl border border-border bg-card px-4 py-3 text-[13px]">
            {[
              ["Template name", facts.name],
              ["Language", languageLabel(facts.language)],
              ["Category", categoryLabel(facts.category)],
              ["Meta template id", facts.metaId ?? "not assigned yet"],
              ["Sample image", facts.hasMedia ? "stored in this workspace" : "none"],
              ["Last change", updatedLabel(facts.updatedAt)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-start justify-between gap-3 border-b border-border/70 py-2 first:pt-1 last:border-0 last:pb-1"
              >
                <dt className="shrink-0 text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium break-all text-foreground">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </aside>

        <div className="space-y-4">
          {stats?.warning ? (
            <p className="flex items-start gap-2 rounded-lg border border-warning/45 bg-warning/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                {watched.size > 0
                  ? `Meta did not answer for ${[...watched].join(" and ").toLowerCase()}. `
                  : ""}
                {stats.warning}
              </span>
            </p>
          ) : null}

          {stats && !stats.insightsEnabled ? (
            <div className="rounded-xl border border-brand/35 bg-brand-soft/40 p-4">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                <Sparkles aria-hidden="true" className="size-4 text-brand" />
                Template insights are off
              </h2>
              <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
                Meta only reports per-template performance once insights are
                switched on for the WhatsApp account. The switch is one-way and
                applies to every template on this number, so it is a decision
                rather than a toggle.
              </p>

              {confirming ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    disabled={busy}
                    onClick={turnOnInsights}
                    size="sm"
                    type="button"
                    variant="brand"
                  >
                    {busy ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : null}
                    Yes, turn insights on
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Not now
                  </Button>
                </div>
              ) : (
                <Button
                  className="mt-3"
                  onClick={() => setConfirming(true)}
                  size="sm"
                  type="button"
                  variant="brand"
                >
                  <Sparkles />
                  Enable template insights
                </Button>
              )}
            </div>
          ) : null}

          <section aria-labelledby="cost-heading">
            <h2
              id="cost-heading"
              className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase"
            >
              Cost · last {days} days
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-card">
                <KpiTile
                  accent="brand"
                  hint={`Meta's charge for this template over ${days} days${stats?.currency ? `, in ${stats.currency}` : ""}.`}
                  icon={Wallet}
                  label="Amount spent"
                  value={money(stats?.cost.amountSpent ?? null)}
                />
              </div>
              <div className="rounded-xl border border-border bg-card">
                <KpiTile
                  accent="blue"
                  hint="Window spend ÷ messages delivered — recomputed, not an average of daily figures."
                  icon={Send}
                  label="Cost per delivered"
                  value={money(stats?.cost.perDelivered ?? null)}
                />
              </div>
              <div className="rounded-xl border border-border bg-card">
                <KpiTile
                  accent="lime"
                  hint="Window spend ÷ URL-button clicks. Only URL buttons report clicks."
                  icon={MousePointerClick}
                  label="Cost per URL click"
                  value={money(stats?.cost.perUrlClick ?? null)}
                />
              </div>
            </div>
          </section>

          <section aria-labelledby="performance-heading">
            <h2
              id="performance-heading"
              className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase"
            >
              Performance · last {days} days
            </h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                hint="Times this template was dispatched."
                icon={Send}
                label="Messages sent"
                value={performance?.sent}
              />
              <Stat
                hint="Reached the customer's phone."
                icon={CheckCheck}
                label="Message delivered"
                value={performance?.delivered}
              />
              <Stat
                hint="Opened by the customer."
                icon={Eye}
                label="Message read"
                value={performance?.read}
              />
              <Stat
                hint="Conversations that answered. Counted here, because Meta publishes no replies metric."
                icon={MessageCircle}
                label="Unique replies"
                value={performance?.uniqueReplies}
              />
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
              {performance?.clicked
                ? `${performance.clicked.toLocaleString()} URL-button ${
                    performance.clicked === 1 ? "click" : "clicks"
                  } in this window.`
                : "Meta reports reads and clicks for 7 days after a message is sent, and clicks only for a URL button."}
            </p>
          </section>

          {stats && stats.series.length > 0 ? (
            <div className="rounded-xl border border-border bg-card">
              <MultiTrendCard
                className="min-h-[19rem]"
                meta={
                  <span className="text-[11px] text-muted-foreground">
                    daily · UTC
                  </span>
                }
                note={`${stats.series.length} days`}
                series={lines}
                title="Messages per day"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild size="sm" variant="ghost">
      <Link href="/workspace/templates">
        <ArrowLeft />
        All templates
      </Link>
    </Button>
  );
}

/** One performance counter. Smaller than a KPI tile: four of them share a row. */
function Stat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  /** Undefined while the first read is in flight, null when Meta would not answer. */
  value: number | null | undefined;
  hint: string;
  icon: typeof Send;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </p>
        <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
      </div>
      <p
        className="mt-2 text-2xl leading-none font-semibold tracking-[-0.02em] text-foreground tabular-nums"
        style={{ fontFamily: "var(--font-geist-mono)" }}
      >
        {value === undefined || value === null ? "—" : value.toLocaleString()}
      </p>
      <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

function countSeries(
  stats: TemplateAnalytics | null,
  pick: (day: TemplateAnalytics["series"][number]) => number,
) {
  return (stats?.series ?? []).map((day) => ({
    label: shortDate(day.date),
    value: pick(day),
  }));
}

function shortDate(date: string): string {
  const at = Date.parse(`${date}T00:00:00.000Z`);

  if (Number.isNaN(at)) return date;

  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Money in Meta's own currency. A null is an em dash: Meta withholds cost
 * under some billing arrangements, and "0.00" would read as "this was free".
 */
function moneyLabel(value: number | null, currency: string | null): string {
  if (value === null) return "—";

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: value !== 0 && value < 1 ? 4 : 2,
    }).format(value);
  } catch {
    return `${currency ?? ""} ${value.toFixed(2)}`.trim();
  }
}

function readReason(caught: unknown): string {
  return caught instanceof ApiError
    ? caught.message
    : "The request failed before the API answered.";
}
