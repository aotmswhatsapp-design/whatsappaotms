"use client";

import * as React from "react";
import { CornerDownLeft, Loader2, Send, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { ApiError, askAgent, fetchSources } from "../api";
import type { Agent, AskResult, Citation, Source } from "../types";

const FIELD =
  "w-full rounded-lg border border-input bg-background px-3 text-[13.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";

interface Entry {
  id: string;
  question: string;
  result: AskResult;
}

/**
 * Where in its file a slice came from, in words the reader of the file would
 * use: a page for a PDF, a sheet and its rows for a workbook, a record range
 * for a CSV.
 *
 * The citation carries a sheet name for both spreadsheets and CSVs — the CSV
 * reader files its records under the name "CSV", and a workbook may own a
 * sheet with that same name — so a sheet name alone proves nothing. Only the
 * source's MIME can say which numbering the rows use, and the source lookup
 * may not have answered yet; without it the place is described generically
 * rather than guessed wrong.
 */
function placeOf(citation: Citation, source: Source | undefined): string | null {
  if (citation.page !== null) return `Page ${citation.page}`;

  const range = rowRange(citation);

  if (source?.mime === "text/csv") {
    return range === null ? "Records" : `Records ${range}`;
  }

  // The sheet name is only trusted once the file's type is known: `CSV` is a
  // plausible worksheet name as well as the label the CSV reader files its
  // records under, so without the source it is dropped rather than guessed.
  const sheet = source?.mime ? citation.sheet : null;

  if (sheet === null) return range === null ? null : `Rows ${range}`;
  return range === null ? sheet : `${sheet} · rows ${range}`;
}

/** `12` for one row, `12–18` for a span, null when the slice named none. */
function rowRange(citation: Citation): string | null {
  if (citation.rowFrom === null) return null;
  if (citation.rowTo === null || citation.rowTo === citation.rowFrom) {
    return String(citation.rowFrom);
  }

  return `${citation.rowFrom}–${citation.rowTo}`;
}

/**
 * The playground: the same retrieval and the same prompt as a live reply, with
 * the send step removed.
 *
 * This is the screen that decides whether an agent is safe to activate — it
 * needs no WhatsApp traffic, and it shows the citations, so "it sounded right"
 * can be checked against what it actually read.
 */
export function Playground({ agent }: { agent: Agent }) {
  const toast = useToast();

  const [question, setQuestion] = React.useState("");
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [sources, setSources] = React.useState<Record<string, Source>>({});

  // A citation says which slice it read but not what kind of file it came from,
  // and the row wording depends on that. The list is fetched once per agent;
  // a failure only costs the wording, so a citation still shows its title.
  React.useEffect(() => {
    let cancelled = false;

    fetchSources(agent.id)
      .then(({ sources: list }) => {
        if (cancelled) return;

        setSources(Object.fromEntries(list.map((source) => [source.id, source])));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  async function ask() {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    setBusy(true);

    try {
      const result = await askAgent(agent.id, trimmed);

      setEntries((current) => [
        { id: `${Date.now()}`, question: trimmed, result },
        ...current,
      ]);
      setQuestion("");
    } catch (caught) {
      toast.push({
        title: "The agent could not answer",
        description:
          caught instanceof ApiError
            ? caught.message
            : "The playground request failed.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form
        className="rounded-xl border border-border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <div className="flex items-end justify-between gap-3">
          <label
            className="text-[13px] font-medium text-foreground"
            htmlFor="playground-question"
          >
            Ask what a customer would ask
          </label>
          <span className="text-[11.5px] tabular-nums text-muted-foreground">
            {question.length} / 2,000
          </span>
        </div>

        <textarea
          className={cn(FIELD, "mt-1.5 min-h-[84px] resize-y py-2.5 leading-relaxed")}
          disabled={busy}
          id="playground-question"
          maxLength={2_000}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line: the same shape as the
            // inbox composer, so the habit carries over.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask();
            }
          }}
          placeholder="Do you deliver to Mumbai, and how much is a kilo?"
          value={question}
        />

        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            Nothing is sent to WhatsApp. Every question is still recorded as a
            run, so its tokens appear in Activity.
          </p>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex">
              <CornerDownLeft className="size-3" aria-hidden="true" />
              Enter
            </span>
            <Button disabled={busy || !question.trim()} size="sm" type="submit" variant="brand">
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
              Ask
            </Button>
          </div>
        </div>
      </form>

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-8 text-center text-[12.5px] leading-relaxed text-muted-foreground">
          No question yet. Ask one whose answer you know is in the material, then
          one that is not — the second should offer to hand the customer to a
          person.
        </p>
      ) : null}

      <ul className="space-y-4">
        {entries.map((entry) => (
          <li
            className="rounded-xl border border-border bg-card p-4"
            key={entry.id}
          >
            <p className="text-[12.5px] font-medium text-muted-foreground">
              {entry.question}
            </p>

            {entry.result.reason === "no-context" ? (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-warning/45 bg-warning/10 px-2.5 py-1 text-[11.5px] font-medium text-foreground">
                <TriangleAlert className="size-3.5" aria-hidden="true" />
                Nothing in the material answered this
              </p>
            ) : null}

            <p className="mt-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-foreground">
              {entry.result.answer}
            </p>

            {entry.result.citations.length > 0 ? (
              <div className="mt-3 space-y-1.5">
                <p className="text-[11.5px] font-medium text-muted-foreground">
                  Read from
                </p>
                {entry.result.citations.map((citation, index) => {
                  const place = placeOf(citation, sources[citation.sourceId]);

                  return (
                    <div
                      className="rounded-lg border border-border bg-background px-2.5 py-2"
                      key={`${entry.id}-${index}-${citation.sourceId}-${citation.score}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-medium text-foreground">
                            {citation.title}
                          </p>
                          {place !== null ? (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {place}
                            </p>
                          ) : null}
                        </div>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {citation.score.toFixed(2)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
                        {citation.text}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <p className="mt-3 text-[11px] tabular-nums text-muted-foreground">
              {entry.result.tokens.input.toLocaleString()} in ·{" "}
              {entry.result.tokens.output.toLocaleString()} out ·{" "}
              {entry.result.tokens.embedding.toLocaleString()} embedding tokens
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
