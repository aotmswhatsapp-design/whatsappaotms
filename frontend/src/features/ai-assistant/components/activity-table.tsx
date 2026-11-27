"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/workspace/data-table";
import { cn } from "@/lib/utils";

import { ApiError, fetchRuns } from "../api";
import type { Agent, Run, RunStatus, Usage } from "../types";

/** One screenful. The endpoint caps at 100; paging is how a year gets read. */
const PAGE = 25;

/** Every terminal state, in the pill it is drawn in. */
const STATUS: Record<RunStatus, { label: string; className: string }> = {
  QUEUED: {
    label: "Queued",
    className: "border-warning/40 bg-warning/5 text-warning",
  },
  CLAIMED: {
    label: "Running",
    className: "border-warning/40 bg-warning/5 text-warning",
  },
  SENT: {
    label: "Sent",
    className: "border-brand/40 bg-brand-soft text-foreground",
  },
  SKIPPED: {
    label: "Skipped",
    className: "border-border bg-secondary text-muted-foreground",
  },
  FAILED: {
    label: "Failed",
    className: "border-destructive/40 bg-destructive/5 text-destructive",
  },
};

/** The one-word `reason` column, as a sentence a person can act on. */
const REASONS: Record<string, string> = {
  paused: "A person has this thread",
  superseded: "A newer message arrived first",
  "window-closed": "The 24-hour window had closed",
  "no-context": "Nothing in the material matched",
  unavailable: "Answering failed",
  "no-agent": "No active agent on the number",
  "no-channel": "The number was disconnected",
  handoff: "Handed to a person",
};

const COLUMNS: DataTableColumn[] = [
  { key: "when", label: "When" },
  { key: "kind", label: "Kind" },
  { key: "status", label: "Status" },
  { key: "reason", label: "Why" },
  { key: "latency", label: "Took" },
  { key: "open", label: "" },
];

/**
 * One run per row, newest first, with the totals of the same query above it.
 *
 * Nothing here is live: a run is written by the server's runner, so the table
 * is read when the tab opens and when the operator asks again.
 */
export function ActivityTable({ agent }: { agent: Agent }) {
  const [runs, setRuns] = React.useState<Run[] | null>(null);
  const [usage, setUsage] = React.useState<Usage | null>(null);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [paging, setPaging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;

    fetchRuns(agent.id, { limit: PAGE })
      .then((next) => {
        if (!active) return;

        setRuns(next.runs);
        setUsage(next.usage);
        setCursor(next.nextCursor);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;

        setError(
          caught instanceof ApiError
            ? caught.message
            : "The activity could not be read.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [agent.id, attempt]);

  /** A cursor page is appended, never merged: the rows are already unique. */
  async function older(): Promise<void> {
    if (!cursor || paging) return;

    setPaging(true);

    try {
      const next = await fetchRuns(agent.id, { limit: PAGE, cursor });

      setRuns((current) => [...(current ?? []), ...next.runs]);
      setCursor(next.nextCursor);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Older runs could not be read.",
      );
    } finally {
      setPaging(false);
    }
  }

  // The spinner belongs to the fetch, not to the effect: raising it here is
  // what keeps `loading` out of the effect body, which React's lint rules
  // reject as a state update on every run of an effect.
  const reload = () => {
    setLoading(true);
    setAttempt((count) => count + 1);
  };

  return (
    <section className="space-y-3">
      <div className="max-w-[12rem] overflow-hidden rounded-xl border border-border">
        <Figure label="Runs" value={(usage?.runs ?? 0).toLocaleString()} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Every run for this agent, newest first. Answering is local, so a run
          costs nothing but the seconds it took.
        </p>
        <Button
          disabled={loading}
          onClick={reload}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground" role="alert">
          {error}
        </p>
      ) : null}

      {runs === null && loading ? (
        <div className="grid h-40 place-items-center rounded-xl border border-border bg-card">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          empty={
            <p className="py-4 text-center text-[13px] text-muted-foreground">
              No runs yet. One appears here when the agent answers a customer, or
              when you ask a question on the Playground.
            </p>
          }
          rows={(runs ?? []).map((run) => [
            <span key="when" className="whitespace-nowrap tabular-nums text-muted-foreground">
              {when(run.createdAt)}
            </span>,
            <span key="kind" className="whitespace-nowrap">
              {run.kind === "PLAYGROUND" ? "Playground" : "Reply"}
            </span>,
            <span
              key="status"
              className={cn(
                "inline-flex h-5 items-center rounded-full border px-2 text-[10.5px] font-medium whitespace-nowrap",
                STATUS[run.status].className,
              )}
            >
              {STATUS[run.status].label}
            </span>,
            <span key="reason" className="block max-w-[16rem] min-w-0">
              {run.reason ? (
                <span className="block truncate text-muted-foreground" title={run.reason}>
                  {REASONS[run.reason] ?? run.reason}
                </span>
              ) : null}
              {run.error ? (
                <span className="block truncate text-destructive" title={run.error}>
                  {run.error}
                </span>
              ) : null}
              {!run.reason && !run.error ? (
                <span className="text-muted-foreground/60">—</span>
              ) : null}
            </span>,
            <span key="latency" className="tabular-nums whitespace-nowrap text-muted-foreground">
              {latency(run.latencyMs)}
            </span>,
            <span key="open">
              {run.conversationId ? (
                <Link
                  className="inline-flex items-center gap-0.5 text-[12px] font-medium whitespace-nowrap text-brand hover:underline"
                  href={`/workspace/inbox?conversation=${run.conversationId}`}
                >
                  Open
                  <ArrowUpRight aria-hidden="true" className="size-3" />
                </Link>
              ) : null}
            </span>,
          ])}
        />
      )}

      {cursor ? (
        <div className="flex justify-center">
          <Button
            disabled={paging}
            onClick={() => void older()}
            size="sm"
            type="button"
            variant="outline"
          >
            {paging ? <Loader2 className="animate-spin" /> : null}
            Load older runs
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** One number and its name, in the totals strip. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

/** `12 Nov, 14:32` — the browser's locale, after a client fetch. */
function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function latency(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1_000) return `${ms} ms`;

  return `${(ms / 1_000).toFixed(1)} s`;
}
