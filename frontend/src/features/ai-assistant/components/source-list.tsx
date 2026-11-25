"use client";

import * as React from "react";
import { FileText, Image as ImageIcon, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { ApiError, deleteSource, retrySource } from "../api";
import type { Source, SourceStatus } from "../types";

const STATUS: Record<SourceStatus, { label: string; className: string }> = {
  PENDING: { label: "Queued", className: "border-border bg-secondary text-muted-foreground" },
  PROCESSING: { label: "Indexing", className: "border-brand/40 bg-brand-soft text-foreground" },
  READY: { label: "Ready", className: "border-whatsapp/40 bg-whatsapp/10 text-foreground" },
  FAILED: { label: "Failed", className: "border-destructive/40 bg-destructive/5 text-foreground" },
};

function sizeOf(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * One row per source. The status word is the state; the failure reason sits
 * under it, because "Failed" alone tells nobody what to do next.
 */
export function SourceList({
  agentId,
  sources,
  onChanged,
}: {
  agentId: string;
  sources: Source[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [armed, setArmed] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function remove(source: Source) {
    setBusy(source.id);

    try {
      await deleteSource(agentId, source.id);
      setArmed(null);
      onChanged();
      toast.push({
        title: "Source removed",
        description: `${source.title} and everything indexed from it are gone.`,
        tone: "success",
      });
    } catch (caught) {
      toast.push({
        title: "Could not remove the source",
        description:
          caught instanceof ApiError ? caught.message : "The source stayed.",
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  async function retry(source: Source) {
    setBusy(source.id);

    try {
      await retrySource(agentId, source.id);
      onChanged();
      toast.push({
        title: "Queued again",
        description: `${source.title} will be read on the next pass.`,
        tone: "success",
      });
    } catch (caught) {
      toast.push({
        title: "Could not queue the source",
        description:
          caught instanceof ApiError ? caught.message : "Nothing changed.",
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  if (sources.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-card/60 px-3 py-4 text-[12.5px] leading-relaxed text-muted-foreground">
        No material yet. Add a price list, a policy or a voice note above — an
        agent cannot be activated until one source is ready.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {sources.map((source) => {
        const style = STATUS[source.status];
        const Icon = source.kind === "TEXT" ? FileText : ImageIcon;
        const working = busy === source.id;
        const pending = source.status === "PENDING" || source.status === "PROCESSING";

        return (
          <li className="flex items-start gap-3 px-3.5 py-3" key={source.id}>
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
              <Icon className="size-4" aria-hidden="true" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-[13px] font-medium text-foreground">
                  {source.title}
                </p>
                <span
                  className={cn(
                    "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    style.className,
                  )}
                >
                  {style.label}
                </span>
              </div>

              <p className="mt-0.5 text-[11.5px] tabular-nums text-muted-foreground">
                {[
                  sizeOf(source.size),
                  source.charCount ? `${source.charCount.toLocaleString()} chars` : "",
                  source.chunkCount ? `${source.chunkCount} chunks` : "",
                  source.status === "READY" ? "searchable" : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>

              {source.error ? (
                <p className="mt-1 text-[11.5px] leading-relaxed text-destructive">
                  {source.error}
                </p>
              ) : null}

              {source.status === "READY" && source.embedTokens > 0 ? (
                <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {source.embedTokens.toLocaleString()} embedding tokens spent
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {source.status === "FAILED" ? (
                <button
                  className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none"
                  disabled={working}
                  onClick={() => void retry(source)}
                  type="button"
                >
                  {working ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Retry
                </button>
              ) : null}

              {armed === source.id ? (
                <div className="flex items-center gap-1">
                  <button
                    className="inline-flex h-8 items-center rounded-md bg-destructive/10 px-2 text-[12px] font-medium text-destructive transition-colors hover:bg-destructive/15 focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none"
                    disabled={working}
                    onClick={() => void remove(source)}
                    type="button"
                  >
                    {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Delete
                  </button>
                  <button
                    className="h-8 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none"
                    onClick={() => setArmed(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  aria-label={`Remove ${source.title}`}
                  className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none disabled:opacity-50"
                  disabled={working || pending}
                  onClick={() => setArmed(source.id)}
                  type="button"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
