"use client";

import * as React from "react";
import Link from "next/link";
import { CircleAlert, FileText, Loader2, Plus, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/workspace/empty-state";
import { cn } from "@/lib/utils";

import {
  ApiError,
  fetchTemplates,
  type TemplateFacts,
  type TemplateListPayload,
} from "../api";
import {
  categoryLabel,
  statusLabel,
  statusTone,
  updatedLabel,
  type StatusTone,
} from "../format";
import { languageLabel } from "../languages";

type StatusFilter = "ALL" | "APPROVED" | "PENDING" | "REJECTED";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "APPROVED", label: "Approved" },
  { value: "PENDING", label: "In review" },
  { value: "REJECTED", label: "Rejected" },
];

const TONES: Record<StatusTone, string> = {
  ok: "border-lime/45 bg-lime/10 text-foreground",
  waiting: "border-warning/45 bg-warning/10 text-foreground",
  bad: "border-destructive/35 bg-destructive/10 text-foreground",
  muted: "border-border bg-secondary text-muted-foreground",
};

const DOTS: Record<StatusTone, string> = {
  ok: "bg-lime",
  waiting: "bg-warning",
  bad: "bg-destructive",
  muted: "bg-muted-foreground/60",
};

const QUALITY: Record<string, { label: string; className: string }> = {
  GREEN: { label: "High quality", className: "bg-lime" },
  YELLOW: { label: "Medium quality", className: "bg-warning" },
  RED: { label: "Low quality", className: "bg-destructive" },
};

/**
 * The template list.
 *
 * It is Meta's list, cached for a minute: refresh forces the round trip, and a
 * failed sync keeps the rows on screen with the reason attached. Templates
 * deleted at Meta are hidden rather than listed as tombstones — nothing can be
 * done with them here.
 */
export function TemplatesView() {
  const [list, setList] = React.useState<TemplateListPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<StatusFilter>("ALL");
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;

    fetchTemplates()
      .then((next) => {
        if (!active) return;
        setList(next);
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

  async function refresh() {
    setRefreshing(true);

    try {
      setList(await fetchTemplates(true));
      setError(null);
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setRefreshing(false);
    }
  }

  if (loading && !list) {
    return (
      <div className="grid h-64 place-items-center rounded-xl border border-border bg-card">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !list) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground">
          The templates could not be read
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

  // Everything except the tombstones a sync leaves behind.
  const templates = (list?.templates ?? []).filter((row) => row.status !== "DELETED");
  const hidden = (list?.templates.length ?? 0) - templates.length;

  if (list && !list.connected && templates.length === 0) {
    return (
      <EmptyState
        action={
          <Button asChild variant="brand">
            <Link href="/workspace/whatsapp">Connect WhatsApp</Link>
          </Button>
        }
        description="Templates belong to a WhatsApp Business account: connect a number, and the ones already in Meta — including any made in WhatsApp Manager — appear here with their review status."
        icon={FileText}
        title="Connect a WhatsApp number"
      />
    );
  }

  const needle = query.trim().toLowerCase();
  const shown = templates.filter((row) => {
    const matchesFilter = filter === "ALL" || row.status === filter;
    const matchesQuery =
      needle.length === 0 ||
      row.name.toLowerCase().includes(needle) ||
      languageLabel(row.language).toLowerCase().includes(needle);

    return matchesFilter && matchesQuery;
  });

  const approved = templates.filter((row) => row.status === "APPROVED").length;
  const pending = templates.filter((row) => row.status === "PENDING").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-44 flex-1 sm:max-w-xs">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              aria-label="Search templates"
              className="h-10 w-full rounded-lg border border-input bg-background pr-3 pl-9 text-[13.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search a name or a language"
              spellCheck={false}
              type="search"
              value={query}
            />
          </div>

          <div
            aria-label="Filter by review status"
            className="flex rounded-lg border border-border bg-card p-0.5"
            role="group"
          >
            {FILTERS.map((entry) => (
              <button
                aria-pressed={filter === entry.value}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
                  filter === entry.value
                    ? "bg-secondary text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={entry.value}
                onClick={() => setFilter(entry.value)}
                type="button"
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            disabled={refreshing}
            onClick={refresh}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            {refreshing ? "Syncing…" : "Refresh"}
          </Button>

          {list?.connected ? (
            <Button asChild size="sm" variant="brand">
              <Link href="/workspace/templates/new">
                <Plus />
                New template
              </Link>
            </Button>
          ) : null}
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

      {list?.stale ? (
        <p className="rounded-lg border border-warning/45 bg-warning/10 px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
          {list.warning
            ? `Showing the last synced list. ${list.warning}`
            : "Showing the last synced list — Meta could not be reached just now."}
        </p>
      ) : null}

      {list && !list.connected ? (
        <p className="rounded-lg border border-warning/45 bg-warning/10 px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
          No number is connected, so this list cannot be refreshed from Meta. It
          is what was last read.
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-foreground">
            {filter === "ALL" ? "All templates" : FILTERS.find((entry) => entry.value === filter)?.label}
          </h2>
          <p className="text-[12px] tabular-nums text-muted-foreground">
            {templates.length} total · {approved} approved · {pending} in review
          </p>
        </div>

        {shown.length === 0 ? (
          <EmptyState
            action={
              templates.length === 0 ? (
                <Button asChild variant="brand">
                  <Link href="/workspace/templates/new">
                    <Plus />
                    Create the first template
                  </Link>
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    setQuery("");
                    setFilter("ALL");
                  }}
                  type="button"
                  variant="outline"
                >
                  Clear filters
                </Button>
              )
            }
            className="border-0 bg-transparent py-10"
            description={
              templates.length === 0
                ? "Meta reviews every template before it can be sent, so the first one starts as a draft here and a status there."
                : "No template matches this search and status."
            }
            icon={FileText}
            title={templates.length === 0 ? "No templates yet" : "Nothing matches"}
          />
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((row) => (
              <TemplateRow key={row.id} row={row} />
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground sm:px-5">
          <span>
            {list?.syncedAt
              ? `Synced from Meta at ${clockOf(list.syncedAt)}`
              : "Not synced yet"}
          </span>
          {hidden > 0 ? (
            <span>{hidden} deleted at Meta hidden</span>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function TemplateRow({ row }: { row: TemplateFacts }) {
  const tone = statusTone(row.status);
  const quality = row.qualityScore ? QUALITY[row.qualityScore.toUpperCase()] : undefined;

  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-[13.5px] font-medium text-foreground">
              {row.name}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium",
                TONES[tone],
              )}
            >
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOTS[tone])} />
              {statusLabel(row.status)}
            </span>
            {quality ? (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <span aria-hidden="true" className={cn("size-1.5 rounded-full", quality.className)} />
                {quality.label}
              </span>
            ) : null}
          </p>

          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {bodyOf(row.components) ?? "No body text stored for this template."}
          </p>

          {row.rejectedReason ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-snug text-destructive">
              <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              {row.rejectedReason}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span className="rounded-full border border-border bg-secondary px-2 py-0.5">
            {categoryLabel(row.category)}
          </span>
          <span className="rounded-full border border-border bg-secondary px-2 py-0.5">
            {languageLabel(row.language)}
          </span>
          <span className="tabular-nums">{updatedLabel(row.updatedAt)}</span>
        </div>
      </div>
    </li>
  );
}

/** BODY text out of Meta's components array, for the row's one-line summary. */
function bodyOf(components: unknown): string | null {
  if (!Array.isArray(components)) return null;

  for (const component of components) {
    if (typeof component !== "object" || component === null) continue;

    const { type, text } = component as { type?: unknown; text?: unknown };

    if (type === "BODY" && typeof text === "string" && text.trim()) {
      return text.trim();
    }
  }

  return null;
}

function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readError(caught: unknown): string {
  return caught instanceof ApiError
    ? caught.message
    : "The templates could not be read.";
}
