"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  GripVertical,
  Inbox,
  Loader2,
  Percent,
  RefreshCw,
  RotateCcw,
  Send,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DraggableWidgetGrid,
  type WidgetItem,
} from "@/components/ui/draggable-widget-grid";
import { EmptyState } from "@/components/workspace/empty-state";
import {
  ApiError,
  fetchOverview,
  type AnalyticsHour,
  type AnalyticsOverview,
} from "@/features/analytics/api";
import { cn } from "@/lib/utils";

import { FlowCard, KpiTile, SeasonalityCard, TrendCard } from "./charts";
import { ConnectionWidget, SetupWidget } from "./panels";
import { SpendCard, money } from "./spend-card";

/**
 * The workspace dashboard: one draggable grid where every card is a reading
 * of the connected Meta account. Rearranging is what changes which reading
 * sits where, and the order is remembered per browser.
 *
 * Nothing on the grid is a sample. Each figure is a Graph analytics read made
 * by the API (see `AnalyticsService`); a section Meta refused renders as
 * missing rather than as zero, so a blank panel never reads as a quiet month.
 *
 * Sizes must tile exactly at four columns — two `lg`, two `tall`, two `wide`
 * and four `sm` fill five rows with no gaps.
 */
const WIDGETS: WidgetItem[] = [
  { id: "delivery-trend", size: "lg", label: "Messages sent" },
  { id: "setup", size: "lg", label: "Finish setting up" },
  { id: "flow", size: "tall", label: "Inbound vs outbound by hour" },
  { id: "seasonality", size: "tall", label: "Messages by month" },
  { id: "spend", size: "wide", label: "Spend by pricing category" },
  { id: "connection", size: "wide", label: "WhatsApp connection" },
  { id: "sent", size: "sm", label: "Messages sent" },
  { id: "inbound", size: "sm", label: "Inbound" },
  { id: "delivery-rate", size: "sm", label: "Delivery rate" },
  { id: "spend-total", size: "sm", label: "Estimated spend" },
];

const STORAGE_KEY = "aotms.dashboard.layout.v1";

export function DashboardBoard() {
  // Remounting the grid is the cleanest reset: it drops the internal order and
  // re-reads storage, which by then is empty.
  const [layoutKey, setLayoutKey] = useState(0);
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    fetchOverview()
      .then((next) => {
        if (!active) return;
        setData(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(readError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  const refresh = async () => {
    setRefreshing(true);

    try {
      setData(await fetchOverview(true));
      setError(null);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setRefreshing(false);
    }
  };

  const resetLayout = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing stored, or storage is unavailable: a remount still resets.
    }
    setLayoutKey((key) => key + 1);
  };

  const renderItem = useCallback(
    (item: WidgetItem) => {
      if (item.id === "setup") return <SetupWidget />;
      if (item.id === "connection") return <ConnectionWidget />;

      if (!data) {
        return <Missing title={item.label ?? "Reading"} note="Still reading from Meta." />;
      }

      switch (item.id) {
        case "delivery-trend": {
          const series = (data.daily ?? []).map((point) => ({
            label: dayLabel(point.start),
            value: point.sent,
          }));

          if (series.length < 2) {
            return (
              <Missing
                title="Messages sent"
                note="Meta has not reported a full window of traffic yet. The line appears with the second day of data."
              />
            );
          }

          const totals = data.totals;
          const sent = totals?.sent ?? series.reduce((sum, point) => sum + point.value, 0);

          return (
            <TrendCard
              label="Messages sent"
              value={sent}
              note={
                totals
                  ? `${fmt(totals.delivered)} delivered · ${percent(totals.deliveryRate)}`
                  : "Delivery figures were not answered."
              }
              caption={`Last ${data.window?.days ?? 28} days`}
              series={series}
            />
          );
        }

        case "flow": {
          const hours = hourlyBuckets(data.hourly ?? []);

          if (hours.length < 2) {
            return (
              <Missing
                title="Inbound vs outbound"
                note="Meta has not reported a full day of traffic yet."
              />
            );
          }

          return (
            <FlowCard
              title="Inbound vs outbound"
              total={hours.reduce((sum, hour) => sum + hour.sent, 0)}
              note="Last 24 hours, half-hour buckets"
              inbound={hours.map((hour) => hour.inbound)}
              outbound={hours.map((hour) => Math.max(0, hour.sent - hour.inbound))}
            />
          );
        }

        case "seasonality": {
          const monthly = data.monthly ?? [];

          if (monthly.length < 2) {
            return (
              <Missing
                title="Messages by month"
                note="Meta has not reported two full months yet, and a shape needs at least two points."
              />
            );
          }

          return (
            <SeasonalityCard
              title="Messages by month"
              months={monthly.map((point) => monthLabel(point.start))}
              current={monthly.map((point) => point.sent)}
            />
          );
        }

        case "spend":
          return <SpendCard rows={data.pricing} currency={data.currency} />;

        case "sent":
          return (
            <KpiTile
              label="Messages sent"
              value={data.totals ? fmt(data.totals.sent) : "—"}
              hint={
                data.totals
                  ? `Across the last ${data.window?.days ?? 28} days`
                  : "Meta did not answer this reading."
              }
              icon={Send}
              accent="brand"
            />
          );

        case "inbound":
          return (
            <KpiTile
              label="Inbound"
              value={data.totals ? fmt(data.totals.inbound) : "—"}
              hint={
                data.totals
                  ? "Conversations customers started"
                  : "Meta did not answer this reading."
              }
              icon={Inbox}
              accent="blue"
            />
          );

        case "delivery-rate":
          return (
            <KpiTile
              label="Delivery rate"
              value={data.totals ? percent(data.totals.deliveryRate) : "—"}
              hint={
                data.totals
                  ? `${fmt(data.totals.delivered)} of ${fmt(data.totals.sent)} delivered`
                  : "Meta did not answer this reading."
              }
              icon={Percent}
              accent="lime"
            />
          );

        case "spend-total": {
          const total = spendOf(data.pricing);

          return (
            <KpiTile
              label="Estimated spend"
              value={total === null ? "—" : money(total, data.currency)}
              hint={
                total === null
                  ? "Meta reported volume without a cost for this window."
                  : "Meta's billing for the same window"
              }
              icon={Wallet}
              accent="muted"
            />
          );
        }

        default:
          return null;
      }
    },
    [data],
  );

  if (loading && !data) {
    return (
      <div className="grid h-64 place-items-center rounded-xl border border-border bg-card">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground">
          The analytics could not be read
        </h2>
        <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
          {error}
        </p>
        <Button
          className="mt-4"
          onClick={() => {
            setLoading(true);
            setError(null);
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

  if (data && !data.connected) {
    return (
      <EmptyState
        action={
          <Button asChild variant="brand">
            <Link href="/workspace/whatsapp">Connect WhatsApp</Link>
          </Button>
        }
        description="This dashboard reads live from the WhatsApp Business account behind your number: messages sent and delivered, who wrote in, and what Meta billed. Connect a number to see your own traffic instead of an empty grid."
        icon={BarChart3}
        title="Connect a WhatsApp number"
      />
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p
          className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12.5px] leading-relaxed text-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {data && data.unavailable.length > 0 ? (
        <div
          className="flex items-start gap-3 rounded-xl border border-warning/45 bg-warning/10 px-4 py-3"
          role="status"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-warning"
          />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-foreground">
              Meta did not answer {listOf(data.unavailable)} just now.
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
              Everything else on this screen is live.{" "}
              {data.warning ? <span>{data.warning}</span> : null}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <GripVertical className="size-3.5 shrink-0" aria-hidden="true" />
          Drag any card to rearrange. Hold Alt and use the arrows with a
          keyboard. The layout is saved on this device.
        </p>

        <div className="flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {data?.syncedAt ? `Read at ${clockOf(data.syncedAt)}` : ""}
          </span>
          <Button
            disabled={refreshing}
            onClick={refresh}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            {refreshing ? "Reading…" : "Refresh"}
          </Button>
          <button
            type="button"
            onClick={resetLayout}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reset layout
          </button>
        </div>
      </div>

      <DraggableWidgetGrid
        key={layoutKey}
        items={WIDGETS}
        storageKey={STORAGE_KEY}
        renderItem={renderItem}
        cellSize={230}
        maxColumns={4}
        gap={12}
        radius={12}
      />
    </div>
  );
}

/** A card whose reading Meta did not answer, or that has nothing to draw yet. */
function Missing({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex h-full flex-col justify-center gap-1.5 p-4">
      <p className="text-[13px] font-semibold text-foreground">{title}</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{note}</p>
    </div>
  );
}

/**
 * Half-hour buckets folded into hours, newest 24 kept. The wave chart labels
 * its points by hour, so it needs hours — not the 48 buckets Meta returns.
 */
function hourlyBuckets(hours: AnalyticsHour[]): { sent: number; inbound: number }[] {
  const buckets = new Map<number, { sent: number; inbound: number }>();

  for (const hour of hours) {
    const at = new Date(hour.start);
    const key = Date.UTC(
      at.getUTCFullYear(),
      at.getUTCMonth(),
      at.getUTCDate(),
      at.getUTCHours(),
    );
    const bucket = buckets.get(key) ?? { sent: 0, inbound: 0 };

    bucket.sent += hour.sent;
    bucket.inbound += hour.inbound;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-24)
    .map(([, bucket]) => bucket);
}

function spendOf(rows: { cost: number | null }[] | null): number | null {
  if (!rows) return null;

  let total = 0;
  let priced = false;

  for (const row of rows) {
    if (row.cost === null) continue;
    total += row.cost;
    priced = true;
  }

  return priced ? total : null;
}

function fmt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function percent(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short" });
}

function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function listOf(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "part of this screen";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;

  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function readError(caught: unknown): string {
  return caught instanceof ApiError
    ? caught.message
    : "The analytics could not be read.";
}
