"use client";

import * as React from "react";
import Link from "next/link";
import {
  CircleAlert,
  Coins,
  Inbox,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/workspace/empty-state";
import { StatCard } from "@/components/workspace/stat-card";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

import {
  ApiError,
  fetchReport,
  syncAnalytics,
  type AnalyticsReport,
  type SyncOutcome,
} from "../api";
import { SpendChart } from "./spend-chart";
import { TemplateTable } from "./template-table";

type Category = "ALL" | "MARKETING" | "UTILITY" | "AUTHENTICATION";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "MARKETING", label: "Marketing" },
  { value: "UTILITY", label: "Utility" },
  { value: "AUTHENTICATION", label: "Authentication" },
];

/** Meta keeps ninety days, so the presets stop well inside it. */
const PRESETS = [7, 30, 90];

const DATE_INPUT =
  "h-8 rounded-md border border-input bg-background px-2 text-[12.5px] text-foreground shadow-xs outline-none transition-shadow focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";

/**
 * Template cost and usage.
 *
 * Every figure is a stored snapshot of what Meta reported at the last sync;
 * this screen never asks Meta itself, so the numbers always agree with the
 * "last synced" line printed under them. Where Meta returned no charge the
 * screen shows a dash and the server's sentence explaining why — never a zero,
 * because zero is a figure and this is an absence.
 */
export function AnalyticsView() {
  // Null means "whatever the server defaults to": the last thirty days. The
  // dates are not computed while rendering, because this screen is prerendered
  // at build time and `new Date()` there would freeze a build-day date into
  // the first paint.
  const [range, setRange] = React.useState<{
    from: string;
    to: string;
  } | null>(null);
  const [category, setCategory] = React.useState<Category>("ALL");

  const [report, setReport] = React.useState<AnalyticsReport | null>(null);
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  const [syncing, setSyncing] = React.useState(false);
  const [outcome, setOutcome] = React.useState<SyncOutcome | null>(null);
  const [syncError, setSyncError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    fetchReport({
      from: range?.from,
      to: range?.to,
      category: category === "ALL" ? undefined : category,
    })
      .then((next) => {
        if (!active) return;
        setReport(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(readError(caught));
      })
      .finally(() => {
        if (active) setBusy(false);
      });

    return () => {
      active = false;
    };
  }, [range, category, attempt]);

  async function sync() {
    setSyncing(true);
    setSyncError(null);
    setOutcome(null);

    try {
      setOutcome(await syncAnalytics());
    } catch (caught) {
      setSyncError(readError(caught));
    } finally {
      setSyncing(false);
      // Refetch either way: a partial run still wrote the rows it managed.
      setAttempt((count) => count + 1);
    }
  }

  function preset(days: number) {
    setRange({ from: day(days - 1), to: day(0) });
  }

  // The dates the inputs show: the ones picked, or the window the last report
  // covered. Both are strings from data, never a clock read.
  const shownFrom = range?.from || report?.window?.start || "";
  const shownTo = range?.to || report?.window?.end || "";
  const span = range
    ? shownFrom && shownTo
      ? daysBetween(shownFrom, shownTo)
      : 0
    : (report?.window?.days ?? 0);

  if (!report && busy) {
    return (
      <div className="grid h-64 place-items-center rounded-xl border border-border bg-card">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground">
          The analytics could not be read
        </h2>
        <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
          {error ?? "The request failed before the figures arrived."}
        </p>
        <Button
          className="mt-4"
          onClick={() => {
            setBusy(true);
            setAttempt((count) => count + 1);
          }}
          type="button"
          variant="outline"
        >
          <RefreshCw />
          Try again
        </Button>
      </div>
    );
  }

  if (!report.connected) {
    return (
      <EmptyState
        action={
          <Button asChild variant="brand">
            <Link href="/workspace/whatsapp">Connect WhatsApp</Link>
          </Button>
        }
        description="Spend and delivery figures belong to a WhatsApp Business account. Connect a number and press Sync: Meta reports the last ninety days of template activity, and this screen stores it."
        icon={Coins}
        title="Connect a WhatsApp number"
      />
    );
  }

  const totals = report.totals;
  const currency = report.currency;
  const lastSynced = report.lastSyncedAt;

  // A day counts as measured only when some snapshot exists for it. Without
  // one, a zero would be a reading nobody took: Meta either refused the read
  // or insights are off, and "0 sent" would be a claim about the account
  // rather than about our data.
  const days = report.window?.days ?? 0;
  const measured = days > 0 && report.missingDays < days;
  const countOf = (value: number | undefined) =>
    measured ? (value ?? 0).toLocaleString() : "—";
  const countHint = measured ? null : "No snapshot covers these dates yet";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div
            aria-label="Date range"
            className="flex rounded-lg border border-border bg-card p-0.5"
            role="group"
          >
            {PRESETS.map((days) => (
              <button
                aria-pressed={span === days}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
                  span === days
                    ? "bg-secondary text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={days}
                onClick={() => preset(days)}
                type="button"
              >
                {days} days
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <label
              className="text-[11.5px] font-medium text-muted-foreground"
              htmlFor="analytics-from"
            >
              From
            </label>
            <input
              className={DATE_INPUT}
              id="analytics-from"
              max={shownTo || undefined}
              onChange={(event) => {
                if (!event.target.value) return;
                setRange({ from: event.target.value, to: shownTo });
              }}
              type="date"
              value={shownFrom}
            />
            <label
              className="text-[11.5px] font-medium text-muted-foreground"
              htmlFor="analytics-to"
            >
              To
            </label>
            <input
              className={DATE_INPUT}
              id="analytics-to"
              min={shownFrom || undefined}
              onChange={(event) => {
                if (!event.target.value) return;
                setRange({ from: shownFrom, to: event.target.value });
              }}
              type="date"
              value={shownTo}
            />
          </div>

          <div
            aria-label="Filter by template category"
            className="flex rounded-lg border border-border bg-card p-0.5"
            role="group"
          >
            {CATEGORIES.map((entry) => (
              <button
                aria-pressed={category === entry.value}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
                  category === entry.value
                    ? "bg-secondary text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={entry.value}
                onClick={() => setCategory(entry.value)}
                type="button"
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            disabled={syncing}
            onClick={sync}
            size="sm"
            type="button"
            variant="brand"
          >
            <RefreshCw className={cn(syncing && "animate-spin")} />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </div>

      {error ? (
        <p
          className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12.5px] leading-relaxed text-foreground"
          role="alert"
        >
          {error} The figures below are the last ones that loaded, so they
          may not match these filters.
        </p>
      ) : null}

      {syncError ? (
        <p
          className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12.5px] leading-relaxed text-foreground"
          role="alert"
        >
          {syncError}
        </p>
      ) : null}

      {outcome ? <SyncNotice outcome={outcome} /> : null}

      {report.costNote ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/45 bg-warning/10 px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {report.costNote}
        </p>
      ) : null}

      <section
        aria-label="Template analytics summary"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          accent={report.costState === "ACTUAL" ? "brand" : "muted"}
          hint={spendHint(report)}
          icon={Coins}
          label="Total WhatsApp spend"
          value={formatMoney(totals?.spent ?? null, currency)}
        />
        <StatCard
          accent="blue"
          hint={
            countHint ??
            `${totals?.templates ?? 0} templates · ${days} days`
          }
          icon={Send}
          label="Messages sent"
          value={countOf(totals?.sent)}
        />
        <StatCard
          accent="lime"
          hint={
            countHint ??
            rateHint(totals?.delivered ?? 0, totals?.sent ?? 0, "of what was sent")
          }
          icon={Inbox}
          label="Delivered"
          value={countOf(totals?.delivered)}
        />
        <StatCard
          accent="brand"
          hint={
            countHint ??
            rateHint(totals?.read ?? 0, totals?.sent ?? 0, "of what was sent")
          }
          icon={MessageSquare}
          label="Read"
          value={countOf(totals?.read)}
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Monthly spend
            </h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Charges Meta reported, grouped by UTC month.
            </p>
          </div>
          <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
            {lastSynced ? `Last synced ${clockOf(lastSynced)}` : "Never synced"}
          </span>
        </div>
        <div className="mt-4">
          <SpendChart currency={currency} months={report.months} />
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
          <h2 className="text-sm font-semibold text-foreground">
            Template analytics
          </h2>
          <p className="text-[11.5px] text-muted-foreground tabular-nums">
            {report.templates.length}{" "}
            {report.templates.length === 1 ? "template" : "templates"} ·{" "}
            {report.missingDays === 0
              ? "every day in range has a snapshot"
              : `${report.missingDays} ${report.missingDays === 1 ? "day" : "days"} in range without a snapshot`}
          </p>
        </div>

        {report.templates.length === 0 ? (
          <EmptyState
            action={
              <Button disabled={syncing} onClick={sync} type="button" variant="outline">
                <RefreshCw className={cn(syncing && "animate-spin")} />
                Sync now
              </Button>
            }
            className="mt-3"
            description="No stored snapshot has template activity for these dates and this category. Meta reports only days on which messages went out, and keeps ninety days at most."
            icon={Send}
            title="Nothing recorded for these dates"
          />
        ) : (
          <div className="mt-3 rounded-xl border border-border bg-card px-4">
            <TemplateTable currency={currency} rows={report.templates} />
          </div>
        )}
      </section>

      <PricingSection report={report} />

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Sync history</h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Runs against Meta&apos;s template and pricing reads, newest first.
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {report.lastOkAt
              ? `Last successful sync ${clockOf(report.lastOkAt)}`
              : "No successful sync yet"}
          </span>
        </div>

        {report.lastError && !report.runs.some((run) => run.status === "OK") ? (
          <p className="mt-3 rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
            The last run did not finish: {report.lastError}
          </p>
        ) : null}

        {report.runs.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            No sync has run yet. Press Sync now to read the last ninety days from
            Meta.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-border/70">
            {report.runs.map((run) => (
              <li
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-[12px]"
                key={run.id}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn("size-1.5 rounded-full", RUN_DOT[run.status] ?? "bg-muted-foreground/50")}
                  />
                  <span className="font-medium text-foreground">{runLabel(run.status)}</span>
                  <span className="text-muted-foreground">
                    {run.trigger === "SCHEDULED" ? "scheduled" : "manual"} · started{" "}
                    {clockOf(run.startedAt)}
                    {run.finishedAt ? ` · finished ${clockOf(run.finishedAt)}` : ""}
                  </span>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {run.templateRows.toLocaleString()} snapshot rows ·{" "}
                  {run.pricingRows.toLocaleString()} pricing rows
                </span>
                {run.error ? (
                  <span className="w-full text-destructive">{run.error}</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/**
 * The account-level reconciliation, kept visually apart from the template
 * table.
 *
 * `pricing_analytics` counts every delivered message the account paid for —
 * free replies and messages outside any template included — so adding it to a
 * template row would bill that template for messages it never sent.
 */
function PricingSection({ report }: { report: AnalyticsReport }) {
  if (!report.account && report.pricing.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            Account reconciliation
            <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
              Account-wide · ignores the category filter
            </span>
          </h2>
          <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-muted-foreground">
            What Meta charged the account, from its pricing read. It counts free
            replies and messages sent outside any template, so it is shown here
            apart from the template figures — never added to them.
          </p>
        </div>

        {report.account ? (
          <p className="text-[12px] text-muted-foreground tabular-nums">
            <span className="font-semibold text-foreground">
              {formatMoney(report.account.cost, report.currency)}
            </span>{" "}
            over {report.account.volume.toLocaleString()} messages
          </p>
        ) : null}
      </div>

      {report.pricing.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          Meta returned no pricing breakdown for these dates.
        </p>
      ) : (
        <div className="mt-4 max-h-80 overflow-auto">
          <table className="w-full min-w-[44rem] border-collapse text-[12px]">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                <th className="py-2 pr-3 text-left font-semibold">Phone</th>
                <th className="px-3 py-2 text-left font-semibold">Country</th>
                <th className="px-3 py-2 text-left font-semibold">Category</th>
                <th className="px-3 py-2 text-left font-semibold">Type</th>
                <th className="px-3 py-2 text-left font-semibold">Tier</th>
                <th className="px-3 py-2 text-right font-semibold">Volume</th>
                <th className="py-2 pl-3 text-right font-semibold">Cost</th>
              </tr>
            </thead>
            <tbody>
              {report.pricing.map((row) => (
                <tr
                  className="border-b border-border/70"
                  key={`${row.phoneNumber}|${row.country}|${row.pricingCategory}|${row.pricingType}|${row.tier}`}
                >
                  <td className="py-2 pr-3 font-mono text-muted-foreground">
                    {row.phoneNumber || "all"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.country || "all"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {label(row.pricingCategory)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {label(row.pricingType)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.tier || "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-foreground tabular-nums">
                    {row.volume.toLocaleString()}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {row.cost === null ? (
                      <span
                        className="text-muted-foreground"
                        title="Meta returned volume without a charge for this row."
                      >
                        —
                      </span>
                    ) : (
                      <span className="text-foreground">
                        {formatMoney(row.cost, report.currency)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const RUN_DOT: Record<string, string> = {
  OK: "bg-lime",
  PARTIAL: "bg-warning",
  FAILED: "bg-destructive",
  RUNNING: "bg-brand",
};

function SyncNotice({ outcome }: { outcome: SyncOutcome }) {
  const tone =
    outcome.status === "FAILED"
      ? "border-destructive/35 bg-destructive/5"
      : outcome.status === "PARTIAL"
        ? "border-warning/45 bg-warning/10"
        : "border-border bg-secondary/50";

  return (
    <div className={cn("rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed text-foreground", tone)}>
      <span className="font-medium">{runLabel(outcome.status)}.</span>{" "}
      Read {outcome.templatesRead.toLocaleString()} templates and stored{" "}
      {outcome.templateRows.toLocaleString()} snapshot rows and{" "}
      {outcome.pricingRows.toLocaleString()} pricing rows over the last{" "}
      {outcome.windowDays} days
      {outcome.prunedRows > 0
        ? `, pruning ${outcome.prunedRows.toLocaleString()} rows past Meta's ninety-day window`
        : ""}
      .
      {outcome.currency
        ? ` Billing currency: ${outcome.currency}.`
        : " Meta named no billing currency for this account, so amounts are shown without one."}
      {outcome.problem ? ` ${outcome.problem}` : ""}
    </div>
  );
}

function runLabel(status: string): string {
  if (status === "OK") return "Synced";
  if (status === "PARTIAL") return "Partly synced";
  if (status === "FAILED") return "Sync failed";
  if (status === "RUNNING") return "Sync running";

  return status.toLowerCase();
}

function spendHint(report: AnalyticsReport): string {
  const spent = report.totals?.spent ?? null;

  if (spent === null) {
    // The account-level figure is real even when no template reported one;
    // naming it here keeps it visible without pretending it belongs to a
    // template.
    const accountCost = report.account?.cost ?? null;

    if (accountCost !== null) {
      return `The whole account was charged ${formatMoney(accountCost, report.currency)} — Meta gave no per-template split`;
    }

    return report.costState === "UNAVAILABLE"
      ? "Meta reported no cost for these sends"
      : "No charge recorded in this range";
  }

  if (report.currency === null) {
    return "Meta did not name a billing currency";
  }

  return `${formatMoney(report.totals?.costPerDelivered ?? null, report.currency)} per delivered message`;
}

function rateHint(value: number, base: number, suffix: string): string {
  if (base === 0) return "Nothing sent in this range";

  return `${percent(value, base)} ${suffix}`;
}

function percent(value: number, base: number): string {
  return `${((value / base) * 100).toFixed(1)}%`;
}

function label(value: string): string {
  if (!value) return "—";

  const words = value.toLowerCase().replace(/_/g, " ");

  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `YYYY-MM-DD`, `delta` days from today, in UTC. Event handlers only. */
function day(delta: number): string {
  const now = new Date();

  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) +
      delta * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}

/** Inclusive day count between two `YYYY-MM-DD` strings; 0 when invalid. */
function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;

  return Math.round((end - start) / 86_400_000) + 1;
}

function clockOf(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readError(caught: unknown): string {
  return caught instanceof ApiError
    ? caught.message
    : "The analytics could not be read.";
}
