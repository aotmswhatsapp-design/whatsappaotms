"use client";

import * as React from "react";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { addTextSource, ApiError, fetchSources } from "../api";
import type { Agent, Source } from "../types";
import { SourceList } from "./source-list";
import { UploadDropzone } from "./upload-dropzone";

const FIELD =
  "w-full rounded-lg border border-input bg-background px-3 text-[13.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";

/** Long enough for a paragraph of prices, short enough to stay a note. */
const MAX_NOTE = 40_000;

/**
 * The Training tab: what the agent has read, and how to add more.
 *
 * "Training" is indexing — nothing here submits a fine-tune. A source moves
 * PENDING → PROCESSING → READY on the server's runner, so the list refreshes
 * itself until nothing is in flight and then stops.
 *
 * Adding and removing material is the OWNER's job; the list itself is served
 * to every member, so a member sees what the agent has read without the
 * controls that would answer 403.
 */
export function TrainingPanel({
  agent,
  canManage,
  onSourcesChanged,
}: {
  agent: Agent;
  canManage: boolean;
  onSourcesChanged: () => void;
}) {
  const toast = useToast();

  const [sources, setSources] = React.useState<Source[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [fails, setFails] = React.useState(0);

  /** `null` until the first response: an empty list is a signature too. */
  const signature = React.useRef<string | null>(null);
  const report = React.useRef(onSourcesChanged);

  // Refreshed in an effect rather than during render: a ref written while
  // rendering is a render the reader cannot trust. Effects run in declaration
  // order, so the fetch below starts with the current callback on mount; a
  // request already in flight can still resolve with the one before it, which
  // costs at most one skipped parent refresh.
  React.useEffect(() => {
    report.current = onSourcesChanged;
  }, [onSourcesChanged]);

  React.useEffect(() => {
    let active = true;

    fetchSources(agent.id)
      .then((next) => {
        if (!active) return;

        setSources(next.sources);
        setError(null);

        const now = next.sources.map((row) => `${row.id}:${row.status}`).join(",");

        // A row finishing changes the ready count in the header, so tell the
        // parent only when a status actually moved. The first response only
        // records the signature: the parent has just rendered this list.
        if (signature.current !== null && signature.current !== now) {
          report.current();
        }

        signature.current = now;
        setFails(0);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : "The training material could not be read.",
        );
        // Counted so the poll below slows down instead of hammering a dead API.
        setFails((count) => count + 1);
      });

    return () => {
      active = false;
    };
  }, [agent.id, attempt]);

  const working =
    sources?.some(
      (row) => row.status === "PENDING" || row.status === "PROCESSING",
    ) ?? false;

  React.useEffect(() => {
    if (!working) return;

    // One timeout per fetch, never an interval. A successful fetch replaces
    // `sources`, which re-arms this; a failed one changes only `fails`, which
    // re-arms it more slowly — stopping on a dropped request would leave a
    // PROCESSING row on screen forever with nothing left to fetch it.
    const delay = Math.min(3_000 * 2 ** fails, 30_000);
    const timer = window.setTimeout(() => setAttempt((count) => count + 1), delay);

    return () => window.clearTimeout(timer);
  }, [working, sources, fails]);

  async function addNote() {
    if (saving) return;

    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();

    if (!trimmedTitle || !trimmedBody) {
      toast.push({
        title: "A note needs a title and text",
        description: "Both fields are required, the same as a file has a name.",
        tone: "error",
      });
      return;
    }

    setSaving(true);

    try {
      const { source } = await addTextSource(agent.id, {
        title: trimmedTitle,
        body: trimmedBody,
      });

      setSources((current) => (current ? [source, ...current] : [source]));
      setTitle("");
      setBody("");
      onSourcesChanged();
      toast.push({
        title: "Note added",
        description: "It is being indexed now.",
        tone: "success",
      });
    } catch (caught) {
      toast.push({
        title: "Could not add the note",
        description:
          caught instanceof ApiError ? caught.message : "Nothing was saved.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {canManage ? (
        <>
          <UploadDropzone
            agentId={agent.id}
            onUploaded={(source) => {
              setSources((current) => (current ? [source, ...current] : [source]));
              onSourcesChanged();
            }}
          />

          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-end justify-between gap-3">
              <Label htmlFor="note-title">Or type it</Label>
              <span className="text-[11.5px] tabular-nums text-muted-foreground">
                {body.length.toLocaleString()} / {MAX_NOTE.toLocaleString()}
              </span>
            </div>

            <input
              className={cn(FIELD, "mt-1.5 h-10")}
              disabled={saving}
              id="note-title"
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Price list — retail"
              spellCheck={false}
              value={title}
            />

            <Label className="mt-3" htmlFor="note-body">
              Note text
            </Label>
            <textarea
              className={cn(FIELD, "mt-1.5 min-h-[120px] resize-y py-2.5 leading-relaxed")}
              disabled={saving}
              id="note-body"
              maxLength={MAX_NOTE}
              onChange={(event) => setBody(event.target.value)}
              placeholder={
                "Half kg ₹249; one kg ₹449. Delivery in Pune in 24 hours, elsewhere 2–3 days. Cash on delivery available under ₹2,000."
              }
              spellCheck={false}
              value={body}
            />

            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                A note is indexed exactly like a file, and edited by deleting it
                and writing a new one.
              </p>
              <Button
                disabled={saving || !title.trim() || !body.trim()}
                onClick={() => void addNote()}
                size="sm"
                type="button"
                variant="outline"
              >
                {saving ? <Loader2 className="animate-spin" /> : <Plus />}
                Add note
              </Button>
            </div>
          </section>
        </>
      ) : (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
          Read-only. An owner adds, replaces and removes the material this agent
          answers from.
        </p>
      )}

      {error ? (
        <p
          className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12.5px] leading-relaxed text-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-foreground">
            Training material
          </h3>
          <p className="text-[11.5px] tabular-nums text-muted-foreground">
            {agent.readySourceCount} of {agent.sourceCount} ready
          </p>
        </div>

        {sources === null ? (
          <div className="grid h-24 place-items-center rounded-xl border border-border bg-card">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <SourceList
            agentId={agent.id}
            canManage={canManage}
            onChanged={() => setAttempt((count) => count + 1)}
            sources={sources}
          />
        )}
      </div>
    </div>
  );
}
