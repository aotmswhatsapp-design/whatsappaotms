"use client";

import * as React from "react";
import { CalendarClock, Inbox } from "lucide-react";

import { useAccess, useModule } from "@/components/workspace/access-provider";
import { EmptyState } from "@/components/workspace/empty-state";
import { cn } from "@/lib/utils";

import {
  ApiError,
  fetchCrmSettings,
  fetchPipeline,
  fetchTasks,
  setInterest,
  type CrmSettings,
  type FollowUpTask,
  type PipelineView,
  type LeadInterest,
} from "../api";
import { PipelineBoard } from "./pipeline-board";
import { RoutingSettings } from "./routing-settings";
import { TaskList } from "./task-list";

type Tab = "pipeline" | "tasks" | "routing";

const TABS: { key: Tab; label: string }[] = [
  { key: "pipeline", label: "Pipeline" },
  { key: "tasks", label: "My follow-ups" },
  { key: "routing", label: "Routing" },
];

function tabId(key: Tab): string {
  return `crm-tab-${key}`;
}

function panelId(key: Tab): string {
  return `crm-panel-${key}`;
}

/**
 * Three views of the same leads: where they are, what the viewer owes them,
 * and — for the owner — who receives them. The routing tab is the only one
 * behind ownership, because it changes what happens to everybody's work.
 */
export function CrmView() {
  const { role } = useAccess();
  const owner = role === "OWNER";
  const canOverride = owner || role === "ADMIN" || role === "MANAGER";

  // The follow-up list belongs to the inbox module (the API guards it with
  // `inbox`, the board with `crm`), so a role without it neither sees the tab
  // nor fires a request it is certain to lose.
  const tasksEnabled = useModule("inbox");

  const [tab, setTab] = React.useState<Tab>("pipeline");
  const [pipeline, setPipeline] = React.useState<PipelineView | null>(null);
  const [pipelineError, setPipelineError] = React.useState<string | null>(null);
  const [pipelineAttempt, setPipelineAttempt] = React.useState(0);
  const [tasks, setTasks] = React.useState<FollowUpTask[] | null>(null);
  const [tasksError, setTasksError] = React.useState<string | null>(null);
  const [tasksAttempt, setTasksAttempt] = React.useState(0);
  const [settings, setSettings] = React.useState<CrmSettings | null>(null);
  const [settingsError, setSettingsError] = React.useState<string | null>(null);
  const [settingsAttempt, setSettingsAttempt] = React.useState(0);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  // Three reads, three states. They are gated by different modules, so one
  // failing read must neither blank nor retry-starve the others — and a
  // successful read of one must never clear the error another is showing.
  React.useEffect(() => {
    let active = true;

    fetchPipeline()
      .then((board) => {
        if (!active) return;
        setPipeline(board);
        setPipelineError(null);
      })
      .catch((caught: unknown) => {
        if (active) {
          setPipelineError(readError(caught, "The leads could not be read."));
        }
      });

    return () => {
      active = false;
    };
  }, [pipelineAttempt]);

  // The routing card is an owner's read; asking for it as a member would be a
  // 403 the screen never shows anything for.
  React.useEffect(() => {
    if (!owner) return;

    let active = true;

    fetchCrmSettings()
      .then((next) => {
        if (!active) return;
        setSettings(next);
        setSettingsError(null);
      })
      .catch((caught: unknown) => {
        if (active) {
          setSettingsError(readError(caught, "The routing settings could not be read."));
        }
      });

    return () => {
      active = false;
    };
  }, [settingsAttempt, owner]);

  React.useEffect(() => {
    if (!tasksEnabled) return;

    let active = true;

    fetchTasks("mine")
      .then((list) => {
        if (!active) return;
        setTasks(list.tasks);
        setTasksError(null);
      })
      .catch((caught: unknown) => {
        if (active) {
          setTasksError(readError(caught, "Your follow-ups could not be read."));
        }
      });

    return () => {
      active = false;
    };
  }, [tasksAttempt, tasksEnabled]);

  async function override(conversationId: string, interest: LeadInterest) {
    setBusyId(conversationId);

    try {
      await setInterest(conversationId, interest);
      // A manual "not interested" also closes the open task, so both lists
      // re-read instead of patching a row: the board has to show the task it
      // freed, and My follow-ups must not keep the one it cancelled.
      setPipelineAttempt((value) => value + 1);
      setTasksAttempt((value) => value + 1);
    } catch (caught) {
      setPipelineError(readError(caught, "The stage could not be changed."));
    } finally {
      setBusyId(null);
    }
  }

  function taskChanged() {
    // The list is server-ordered and only holds open work, so a closed or
    // moved task is re-read rather than patched in place — a patch would keep
    // a done row on screen and break the deadline order around it.
    setTasksAttempt((value) => value + 1);
    // The board draws the same task's strip, which has just moved or vanished.
    setPipelineAttempt((value) => value + 1);
  }

  const available = TABS.filter(
    (row) =>
      (row.key !== "routing" || owner) && (row.key !== "tasks" || tasksEnabled),
  );
  // The access answer can only widen, but a URL or a role change mid-session
  // must never leave a selected tab with no panel under it.
  const active = available.some((row) => row.key === tab) ? tab : "pipeline";

  const tabRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  function moveTab(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next: number;

    if (event.key === "ArrowRight") next = (index + 1) % available.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + available.length) % available.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = available.length - 1;
    else return;

    event.preventDefault();
    const row = available[next];
    setTab(row.key);
    tabRefs.current[row.key]?.focus();
  }

  return (
    <div className="space-y-3">
      <div
        aria-label="Leads"
        className="flex flex-wrap gap-1 self-start rounded-lg border border-border bg-card p-1"
        role="tablist"
      >
        {available.map((row, index) => (
          <button
            key={row.key}
            aria-controls={panelId(row.key)}
            aria-selected={active === row.key}
            className={cn(
              "rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              active === row.key
                ? "bg-brand-soft text-brand"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            id={tabId(row.key)}
            onClick={() => setTab(row.key)}
            onKeyDown={(event) => moveTab(event, index)}
            ref={(node) => {
              tabRefs.current[row.key] = node;
            }}
            role="tab"
            tabIndex={active === row.key ? 0 : -1}
            type="button"
          >
            {row.label}
          </button>
        ))}
      </div>

      <section
        aria-labelledby={tabId("pipeline")}
        hidden={active !== "pipeline"}
        id={panelId("pipeline")}
        role="tabpanel"
      >
        {pipelineError ? (
          <ErrorNote
            message={pipelineError}
            onRetry={() => {
              // Clearing here, not in the effect: the banner is the last
              // thing on screen until the retry actually answers.
              setPipelineError(null);
              setPipelineAttempt((value) => value + 1);
            }}
          />
        ) : null}

        {pipeline === null ? (
          pipelineError ? null : (
            <Skeleton />
          )
        ) : pipeline.total === 0 ? (
          <EmptyState
            description="A conversation lands here as soon as a customer writes in."
            icon={Inbox}
            title="No leads yet"
          />
        ) : (
          <PipelineBoard
            busyId={busyId}
            canOverride={canOverride}
            columns={pipeline.columns}
            onOverride={(id, next) => void override(id, next)}
          />
        )}
      </section>

      {tasksEnabled ? (
        <section
          aria-labelledby={tabId("tasks")}
          hidden={active !== "tasks"}
          id={panelId("tasks")}
          role="tabpanel"
        >
          {tasksError ? (
            <ErrorNote
              message={tasksError}
              onRetry={() => {
                setTasksError(null);
                setTasksAttempt((value) => value + 1);
              }}
            />
          ) : null}

          {/* The screen must never imply it sends for you: the send button
              hands the text to the member's own WhatsApp, and nothing here can
              see the reply that follows. */}
          <p className="mb-3 text-[11.5px] leading-relaxed text-muted-foreground">
            Sending is manual; delivery is not confirmed. Replies arrive in
            your personal WhatsApp, not this inbox.
          </p>

          {tasks === null ? (
            tasksError ? null : (
              <Skeleton />
            )
          ) : tasks.length === 0 ? (
            <EmptyState
              description="Every interested lead opens one. Nothing is waiting on you."
              icon={CalendarClock}
              title="No follow-ups"
            />
          ) : (
            <TaskList onChanged={taskChanged} tasks={tasks} />
          )}
        </section>
      ) : null}

      {owner ? (
        <section
          aria-labelledby={tabId("routing")}
          hidden={active !== "routing"}
          id={panelId("routing")}
          role="tabpanel"
        >
          {settingsError ? (
            <ErrorNote
              message={settingsError}
              onRetry={() => {
                setSettingsError(null);
                setSettingsAttempt((value) => value + 1);
              }}
            />
          ) : null}

          {settings ? (
            <RoutingSettings onSaved={setSettings} settings={settings} />
          ) : settingsError ? null : (
            <Skeleton />
          )}
        </section>
      ) : null}
    </div>
  );
}

function ErrorNote({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2">
      <p className="text-[12px] leading-relaxed text-destructive">{message}</p>
      {/* Retry re-runs this panel's read only: the tab stays selected and the
          other reads are not thrown away. */}
      <button
        className="shrink-0 text-[12px] font-semibold text-destructive underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        onClick={onRetry}
        type="button"
      >
        Try again
      </button>
    </div>
  );
}

function Skeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-56 animate-pulse rounded-xl border border-border bg-card"
    />
  );
}

function readError(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}
