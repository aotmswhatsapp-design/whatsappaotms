"use client";

import * as React from "react";
import {
  ChevronDown,
  CornerDownLeft,
  Loader2,
  Send,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import { ApiError, askAgent, fetchSources } from "../api";
import type { Agent, AskResult, Citation, Source } from "../types";

/** The longest question the API accepts, mirrored so the counter cannot lie. */
const MAX_QUESTION = 2_000;

/** One line until the text needs more; the box scrolls rather than growing
 *  the card and pushing the conversation out of view. */
const COMPOSER =
  "min-h-9 w-full min-w-0 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-[7px] text-[13px] leading-snug text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";

interface Entry {
  id: string;
  question: string;
  result: AskResult;
  at: Date;
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

/** The bubble's clock, in the reader's own locale. */
function clockOf(at: Date): string {
  return at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The playground: the same retrieval and the same prompt as a live reply, with
 * the send step removed.
 *
 * This is the screen that decides whether an agent is safe to activate — it
 * needs no WhatsApp traffic, and it shows the citations, so "it sounded right"
 * can be checked against what it actually read.
 *
 * Laid out as a conversation rather than a list of results: the question is
 * what a customer would type, the answer is what they would receive, and the
 * citations are a reference the answer can be opened up to rather than a block
 * that crowds it out.
 */
export function Playground({ agent }: { agent: Agent }) {
  const toast = useToast();

  const [question, setQuestion] = React.useState("");
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [sources, setSources] = React.useState<Record<string, Source>>({});
  const scroller = React.useRef<HTMLDivElement | null>(null);

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

  // Newest at the bottom, like the thread it imitates. Only the message box is
  // scrolled — `scrollIntoView` would move the page under a reader who is
  // halfway down the screen.
  React.useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [entries.length, busy]);

  async function ask() {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    setBusy(true);

    try {
      const result = await askAgent(agent.id, trimmed);

      setEntries((current) => [
        ...current,
        {
          id: `${Date.now()}-${current.length}`,
          question: trimmed,
          result,
          at: new Date(),
        },
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

  const initial = agent.name.trim().charAt(0).toUpperCase() || "A";

  return (
    // 680px is the conversation's own width; the page around it is allowed to
    // be wider, so the chat sits centred instead of stretching with the panel.
    <div className="w-full px-3 sm:px-0">
      <div className="mx-auto flex h-[min(68dvh,640px)] min-h-[420px] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-card px-3 py-2">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand"
          >
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foreground">
              {agent.name}
            </p>
            <p className="truncate text-[11px] leading-tight text-muted-foreground">
              Playground · nothing is sent to WhatsApp
            </p>
          </div>
          {entries.length > 0 ? (
            <Button
              disabled={busy}
              onClick={() => setEntries([])}
              size="sm"
              type="button"
              variant="ghost"
            >
              Clear
            </Button>
          ) : null}
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto bg-background px-3 py-3"
          ref={scroller}
        >
          {entries.length === 0 && !busy ? (
            <div className="grid min-h-full place-items-center px-4">
              <p className="max-w-[36ch] text-center text-[12px] leading-relaxed text-muted-foreground">
                Ask what a customer would ask. The agent answers from its own
                material, and every answer keeps what it read one tap away.
              </p>
            </div>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {entries.map((entry) => (
                <React.Fragment key={entry.id}>
                  <li className="flex justify-end">
                    <div className="max-w-[80%] rounded-xl rounded-br-sm bg-brand-soft px-3 py-2 text-foreground shadow-xs">
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                        {entry.question}
                      </p>
                      <p className="mt-1 text-right text-[10px] tabular-nums text-muted-foreground">
                        {clockOf(entry.at)}
                      </p>
                    </div>
                  </li>

                  <li className="flex justify-start">
                    <div className="max-w-[80%] rounded-xl rounded-bl-sm border border-border bg-card px-3 py-2 text-foreground shadow-xs">
                      {entry.result.reason === "no-context" ? (
                        <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-warning/45 bg-warning/10 px-2 py-0.5 text-[11px] font-medium">
                          <TriangleAlert className="size-3" aria-hidden="true" />
                          Nothing in the material answered this
                        </p>
                      ) : null}

                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                        {entry.result.answer}
                      </p>

                      {entry.result.citations.length > 0 ? (
                        <details className="group mt-2 rounded-lg border border-border bg-background/70">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 text-[11px] font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
                            <span>
                              Read from {entry.result.citations.length}{" "}
                              {entry.result.citations.length === 1
                                ? "reference"
                                : "references"}
                            </span>
                            <ChevronDown
                              aria-hidden="true"
                              className="size-3 shrink-0 transition-transform group-open:rotate-180"
                            />
                          </summary>

                          <ul className="space-y-1.5 border-t border-border p-2">
                            {entry.result.citations.map((citation, index) => {
                              const place = placeOf(
                                citation,
                                sources[citation.sourceId],
                              );

                              return (
                                <li
                                  className="rounded-md border border-border bg-card px-2 py-1.5"
                                  key={`${entry.id}-${index}-${citation.sourceId}-${citation.score}`}
                                >
                                  <div className="flex items-baseline justify-between gap-2">
                                    <p className="min-w-0 truncate text-[11.5px] font-medium text-foreground">
                                      {citation.title}
                                    </p>
                                    <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                                      {citation.score.toFixed(2)}
                                    </span>
                                  </div>
                                  {place !== null ? (
                                    <p className="truncate text-[10.5px] leading-tight text-muted-foreground">
                                      {place}
                                    </p>
                                  ) : null}
                                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                                    {citation.text}
                                  </p>
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      ) : null}

                      <p className="mt-1.5 flex items-center justify-end gap-2 text-[10px] tabular-nums text-muted-foreground">
                        <span>{clockOf(entry.at)}</span>
                      </p>
                    </div>
                  </li>
                </React.Fragment>
              ))}

              {busy ? (
                <li aria-live="polite" className="flex justify-start">
                  <div className="inline-flex items-center gap-2 rounded-xl rounded-bl-sm border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
                    <Loader2
                      aria-hidden="true"
                      className="size-3.5 animate-spin"
                    />
                    Reading the material…
                  </div>
                </li>
              ) : null}
            </ol>
          )}
        </div>

        <form
          className="shrink-0 border-t border-border bg-card p-2"
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <div className="flex items-end gap-2">
            <label className="sr-only" htmlFor="playground-question">
              Ask what a customer would ask
            </label>
            <textarea
              className={COMPOSER}
              disabled={busy}
              id="playground-question"
              maxLength={MAX_QUESTION}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter breaks the line: the same shape as
                // the inbox composer, so the habit carries over.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
              placeholder="Do you deliver to Mumbai, and how much is a kilo?"
              rows={1}
              value={question}
            />
            <Button
              disabled={busy || !question.trim()}
              size="sm"
              type="submit"
              variant="brand"
            >
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
              Ask
            </Button>
          </div>

          <div className="mt-1 flex items-center justify-between gap-2 px-1 text-[10.5px] leading-tight text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CornerDownLeft aria-hidden="true" className="size-2.5" />
              Enter sends · Shift+Enter breaks the line
            </span>
            <span className="tabular-nums">
              {question.length} / {MAX_QUESTION.toLocaleString()}
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
