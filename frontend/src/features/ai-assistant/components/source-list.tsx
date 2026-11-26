"use client";

import * as React from "react";
import {
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  ApiError,
  deleteSource,
  replaceSource,
  retrySource,
  sourceDownloadUrl,
} from "../api";
import { ACCEPT_ATTRIBUTE, sizeRejection } from "../limits";
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
 * What the extractor found about the file's shape: how many pages, which
 * sheets and how many rows, or how large the image is.
 *
 * A CSV is stored as a one-sheet table named `CSV`, so its rows are described
 * as records — the same distinction the citation labels make, decided by MIME
 * and never by the sheet name.
 */
function metaOf(source: Source): string {
  const meta = source.meta;
  if (!meta) return "";

  if (meta.kind === "document") {
    if (!meta.pages) return "";
    return `${meta.pages} page${meta.pages === 1 ? "" : "s"}`;
  }

  if (meta.kind === "image") {
    if (!meta.width || !meta.height) return "";
    return `${meta.width}×${meta.height}`;
  }

  const rows = meta.sheets.reduce((total, sheet) => total + sheet.rowCount, 0);
  if (rows === 0) return "";

  if (source.mime === "text/csv") {
    return `${rows.toLocaleString()} records`;
  }

  const sheets = meta.sheets.length;
  return `${sheets} sheet${sheets === 1 ? "" : "s"} · ${rows.toLocaleString()} rows`;
}

/**
 * One row per source. The status word is the state; the failure reason sits
 * under it, because "Failed" alone tells nobody what to do next.
 *
 * Only an OWNER gets the controls that change the list. Members still read it,
 * and still download an original, because the API serves both to every member.
 */
export function SourceList({
  agentId,
  sources,
  canManage,
  onChanged,
}: {
  agentId: string;
  sources: Source[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [armed, setArmed] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [downloading, setDownloading] = React.useState<string | null>(null);
  // The signed link a blocked tab left behind, held until the row is clicked.
  const [fallback, setFallback] = React.useState<{ id: string; url: string } | null>(
    null,
  );

  // One picker for the whole list: which row asked is remembered here, because
  // the file dialog answers long after the click that opened it.
  const picker = React.useRef<HTMLInputElement>(null);
  const target = React.useRef<string | null>(null);

  const byId = React.useMemo(() => {
    const map = new Map<string, Source>();
    for (const source of sources) map.set(source.id, source);

    return map;
  }, [sources]);

  /** The replacement each source is being retired by, while it is still live. */
  const successors = React.useMemo(() => {
    const map = new Map<string, Source>();

    for (const source of sources) {
      if (!source.replacesSourceId) continue;

      // Newest first, so the first one listed is the one to believe — unless it
      // failed, in which case an older successor may still be the live one.
      const seen = map.get(source.replacesSourceId);
      if (!seen || seen.status === "FAILED") {
        map.set(source.replacesSourceId, source);
      }
    }

    return map;
  }, [sources]);

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

  /** Opens the picker for one row; the change handler below does the work. */
  function choose(source: Source) {
    target.current = source.id;
    picker.current?.click();
  }

  async function swap(file: File) {
    const sourceId = target.current;
    target.current = null;

    if (!sourceId) return;

    const rejection = sizeRejection(file);
    if (rejection) {
      toast.push({ title: "Too large", description: rejection, tone: "error" });
      return;
    }

    const replaced = byId.get(sourceId) ?? null;
    setBusy(sourceId);

    try {
      const { source } = await replaceSource(agentId, sourceId, file);

      // The predecessor is still answering: the server retires it only once
      // this row is READY. Both stay on screen until the next refresh says so.
      onChanged();
      setArmed(null);
      toast.push({
        title: "New version uploaded",
        description: replaced
          ? `${source.title} is being indexed. ${replaced.title} keeps answering until it is ready.`
          : `${source.title} is being indexed.`,
        tone: "success",
      });
    } catch (caught) {
      toast.push({
        title: "Could not replace the file",
        description:
          caught instanceof ApiError ? caught.message : "Nothing changed.",
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  async function download(source: Source) {
    // Opened during the click, before the await: afterwards the browser no
    // longer counts this as a user gesture and blocks the tab. `noopener`
    // cannot be asked for at open time — it hands back no handle to navigate —
    // so the opener is severed on the handle instead. Nothing credential-bearing
    // is passed either way; the signed URL is navigated to, never fetched.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;

    setFallback(null);
    setDownloading(source.id);

    try {
      const { url } = await sourceDownloadUrl(agentId, source.id);

      if (tab && !tab.closed) {
        tab.location.replace(url);
        return;
      }

      // The browser refused the tab. The link is offered in the row instead,
      // where a fresh click is a gesture it cannot take away.
      setFallback({ id: source.id, url });
      toast.push({
        title: "The browser blocked the new tab",
        description: "Use Open file in the row to fetch the download.",
        tone: "error",
      });
    } catch (caught) {
      // The blank tab would otherwise sit there with nothing to show.
      tab?.close();
      toast.push({
        title: "Could not download the file",
        description:
          caught instanceof ApiError ? caught.message : "The link was not issued.",
        tone: "error",
      });
    } finally {
      setDownloading(null);
    }
  }

  if (sources.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-card/60 px-3 py-4 text-[12.5px] leading-relaxed text-muted-foreground">
        {canManage
          ? "No material yet. Add a price list, a policy or a voice note above — an agent cannot be activated until one source is ready."
          : "No material yet. The agent has nothing to answer from until an owner adds a source."}
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {sources.map((source) => {
          const style = STATUS[source.status];
          const Icon = source.kind === "TEXT" ? FileText : ImageIcon;
          const working = busy === source.id;
          const pending = source.status === "PENDING" || source.status === "PROCESSING";
          const meta = metaOf(source);
          const successor = successors.get(source.id) ?? null;
          const predecessor = source.replacesSourceId
            ? (byId.get(source.replacesSourceId) ?? null)
            : null;
          // A failed replacement never retires its predecessor and never locks
          // a new attempt, so only a live one blocks the button.
          const liveSuccessor = successor !== null && successor.status !== "FAILED";
          const swappable = canManage && source.kind === "FILE" && !pending && !liveSuccessor;

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
                  {source.replacesSourceId ? (
                    <span className="inline-flex rounded-full border border-brand/40 bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-foreground">
                      New version
                    </span>
                  ) : null}
                </div>

                <p className="mt-0.5 text-[11.5px] tabular-nums text-muted-foreground">
                  {[
                    sizeOf(source.size),
                    meta,
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

                {successor ? (
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                    {successor.status === "READY"
                      ? `Replaced by ${successor.title}. This older copy is being removed.`
                      : successor.status === "FAILED"
                        ? `A replacement, ${successor.title}, failed to index. This copy still answers.`
                        : `Being replaced by ${successor.title}. This copy keeps answering until the new one is ready.`}
                  </p>
                ) : predecessor ? (
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                    Replaces {predecessor.title}, which keeps answering until this
                    one is ready.
                  </p>
                ) : null}

                {source.status === "READY" && source.embedTokens > 0 ? (
                  <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {source.embedTokens.toLocaleString()} embedding tokens spent
                  </p>
                ) : null}

                {/* Extraction can succeed and indexing fail afterwards, and
                    that is exactly when the cost is worth reading. */}
                {source.extractTokens > 0 ? (
                  <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {source.extractTokens.toLocaleString()} extraction tokens spent
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {/* A blocked tab leaves its signed link here: the click on it
                    is a fresh gesture, which the browser will not refuse. */}
                {source.kind === "FILE" && fallback?.id === source.id ? (
                  <a
                    className="inline-flex h-8 items-center rounded-md px-2 text-[12px] font-medium text-foreground underline decoration-border underline-offset-2 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none"
                    href={fallback.url}
                    onClick={() => {
                      // Cleared after the click is handled: the anchor must still
                      // be in the document when the browser follows it.
                      window.setTimeout(() => setFallback(null), 0);
                    }}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Open file
                  </a>
                ) : null}

                {source.kind === "FILE" && fallback?.id !== source.id ? (
                  <button
                    aria-label={`Download ${source.title}`}
                    className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none disabled:opacity-50"
                    disabled={downloading === source.id}
                    onClick={() => void download(source)}
                    title="Download the original file"
                    type="button"
                  >
                    {downloading === source.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" aria-hidden="true" />
                    )}
                  </button>
                ) : null}

                {swappable ? (
                  <button
                    aria-label={`Replace ${source.title}`}
                    className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none disabled:opacity-50"
                    disabled={working}
                    onClick={() => choose(source)}
                    title="Upload a new version of this file"
                    type="button"
                  >
                    {working ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Upload className="size-3.5" aria-hidden="true" />
                    )}
                  </button>
                ) : null}

                {canManage && source.status === "FAILED" ? (
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

                {canManage ? (
                  armed === source.id ? (
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
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {/* One picker for every row: the replacement control only names a target. */}
      <input
        accept={ACCEPT_ATTRIBUTE}
        aria-hidden="true"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void swap(file);
        }}
        ref={picker}
        tabIndex={-1}
        type="file"
      />
    </>
  );
}
