"use client";

import * as React from "react";
import { Bot, Loader2, Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/workspace/empty-state";
import { PageHeader } from "@/components/workspace/page-header";
import { getNavItem } from "@/config/workspace-nav";
import { cn } from "@/lib/utils";

import {
  activateAgent,
  ApiError,
  createAgent,
  deactivateAgent,
  fetchAgent,
  fetchAgents,
} from "./api";
import type { Agent, Channel } from "./types";
import { AgentForm } from "./components/agent-form";
import { Playground } from "./components/playground";
import { TrainingPanel } from "./components/training-panel";

const nav = getNavItem("/workspace/ai");

type Tab = "PROMPT" | "TRAINING" | "PLAYGROUND";

const TABS: { value: Tab; label: string }[] = [
  { value: "PROMPT", label: "Prompt" },
  { value: "TRAINING", label: "Training" },
  { value: "PLAYGROUND", label: "Playground" },
];

/**
 * The agent screen: one number, one prompt, one knowledge base, and the
 * playground that proves it before a customer ever writes.
 *
 * Activation is the only stateful switch: an agent that is not active still
 * indexes material and still answers in the playground, it just never sends.
 */
export function AiView() {
  const toast = useToast();

  const [channel, setChannel] = React.useState<Channel | null>(null);
  const [agents, setAgents] = React.useState<Agent[] | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [agent, setAgent] = React.useState<Agent | null>(null);
  const [tab, setTab] = React.useState<Tab>("PROMPT");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    fetchAgents()
      .then((next) => {
        if (!active) return;

        setAgents(next.agents);
        setChannel(next.channel);
        setError(null);

        // Chosen here rather than in a second effect: `current` is the state
        // this update is replacing, so the list can pick a default without
        // depending on the selection and re-fetching on every switch.
        setSelectedId((current) => {
          if (current && next.agents.some((row) => row.id === current)) {
            return current;
          }

          const preferred =
            next.agents.find((row) => row.isActive) ?? next.agents[0];

          return preferred?.id ?? null;
        });
      })
      .catch((caught: unknown) => {
        if (!active) return;

        setError(
          caught instanceof ApiError
            ? caught.message
            : "The agents could not be read.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  // Nothing to fetch without a selection, and the previous agent is left in
  // state on purpose: `shown` already requires a matching id, so a removed
  // agent cannot render, and clearing it here would be a setState in an
  // effect body. `loading` is raised by `reload` for the same reason.
  React.useEffect(() => {
    if (!selectedId) return;

    let active = true;

    fetchAgent(selectedId)
      .then((next) => {
        if (active) setAgent(next.agent);
      })
      .catch((caught: unknown) => {
        if (!active) return;

        setError(
          caught instanceof ApiError
            ? caught.message
            : "This agent could not be read.",
        );
      });

    return () => {
      active = false;
    };
  }, [selectedId, attempt]);

  const reload = React.useCallback(() => {
    setLoading(true);
    setAttempt((count) => count + 1);
  }, []);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;

    setBusy(true);

    try {
      const next = await createAgent({ name: trimmed });

      setAgents((current) => (current ? [...current, next.agent] : [next.agent]));
      setSelectedId(next.agent.id);
      setAgent(next.agent);
      setTab("PROMPT");
      setName("");
      setCreating(false);
      reload();

      toast.push({
        title: "Agent created",
        description: "Add material on Training, then activate it.",
        tone: "success",
      });
    } catch (caught) {
      toast.push({
        title: "Could not create the agent",
        description:
          caught instanceof ApiError
            ? caught.message
            : "Nothing was created.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(next: boolean) {
    if (!agent || busy) return;

    setBusy(true);

    try {
      const result = next
        ? await activateAgent(agent.id)
        : await deactivateAgent(agent.id);

      setAgent(result.agent);
      reload();

      toast.push({
        title: next ? "Answering automatically" : "No longer answering",
        description: next
          ? "A new message on this number gets a reply from the material."
          : "The material stays indexed. Turn it back on whenever you like.",
        tone: "success",
      });
    } catch (caught) {
      toast.push({
        title: "Could not change the switch",
        description:
          caught instanceof ApiError
            ? caught.message
            : "The agent did not change.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Arrow keys move between tabs without taking the whole tablist out of the
   * Tab sequence: one tab is reachable, and the roving `tabIndex` follows the
   * selection.
   */
  function onTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((entry) => entry.value === tab);
    let next: number | null = null;

    if (event.key === "ArrowLeft") {
      next = (index + TABS.length - 1) % TABS.length;
    } else if (event.key === "ArrowRight") {
      next = (index + 1) % TABS.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = TABS.length - 1;
    }

    if (next === null) return;

    event.preventDefault();

    const entry = TABS[next];
    if (!entry) return;

    setTab(entry.value);
    document.getElementById(`agent-tab-${entry.value}`)?.focus();
  }

  const shown = agent && agent.id === selectedId ? agent : null;
  const untrained = (shown?.readySourceCount ?? 0) === 0;
  const blocked = shown !== null && untrained && !shown.isActive;

  const creator = (
    <form
      className="flex flex-wrap items-center justify-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <input
        aria-label="Agent name"
        className="h-9 w-48 rounded-lg border border-input bg-background px-3 text-[13px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]"
        disabled={busy}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        placeholder="Front desk"
        spellCheck={false}
        value={name}
      />
      <Button disabled={busy || !name.trim()} size="sm" type="submit" variant="brand">
        {busy ? <Loader2 className="animate-spin" /> : <Plus />}
        Create
      </Button>
    </form>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
          <>
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
            {agents && agents.length > 0 ? (
              <Button
                disabled={busy}
                onClick={() => setCreating((open) => !open)}
                size="sm"
                type="button"
                variant="brand"
              >
                <Plus />
                New agent
              </Button>
            ) : null}
          </>
        }
        description="An agent reads your material and answers from it. Nothing is sent until it is active and a customer writes."
        eyebrow={nav.group}
        title={nav.title}
      />

      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Training is indexing, not fine-tuning: the files are read, split and
        embedded once, and every reply quotes what the search returns. One
        active agent per number.
      </p>

      {error ? (
        <div className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2.5">
          <p className="text-[12.5px] leading-relaxed text-foreground" role="alert">
            {error}
          </p>
          <Button
            className="mt-2"
            onClick={reload}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw />
            Try again
          </Button>
        </div>
      ) : null}

      {creating ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 text-[13px] font-medium text-foreground">
            Name the new agent
          </p>
          {creator}
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            It starts inactive. You can rename it and change everything else on
            the Prompt tab.
          </p>
        </section>
      ) : null}

      {loading && agents === null ? (
        <div className="grid h-56 place-items-center rounded-xl border border-border bg-card">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : agents === null || agents.length === 0 ? (
        <EmptyState
          action={channel ? creator : undefined}
          description={
            channel
              ? "An agent answers from the material you give it. Create one, add a price list or a policy, then ask it something in the playground."
              : "Connect a WhatsApp number first — an agent is bound to the number that answers."
          }
          icon={Bot}
          title={channel ? "No agent yet" : "No number connected"}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
          <nav aria-label="Agents" className="space-y-1">
            {agents.map((row) => (
              <button
                aria-current={row.id === selectedId ? "true" : undefined}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
                  row.id === selectedId
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    row.isActive ? "bg-whatsapp" : "bg-muted-foreground/40",
                  )}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">
                    {row.name}
                  </span>
                  <span className="block text-[11px] tabular-nums">
                    {row.isActive ? "answering" : `${row.readySourceCount} ready`}
                  </span>
                </span>
              </button>
            ))}
          </nav>

          <div className="min-w-0 space-y-4">
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="min-w-0">
                <p className="text-[11.5px] text-muted-foreground">Answering on</p>
                <p className="truncate text-[13.5px] font-medium text-foreground">
                  {channel?.display ?? channel?.phoneNumberId ?? "No number connected"}
                </p>
              </div>

              <div className="flex flex-col items-end gap-1">
                <label
                  className="flex items-center gap-2 text-[12.5px] font-medium text-foreground"
                  title={
                    untrained
                      ? "Add material on the Training tab and wait for it to be ready."
                      : shown?.isActive
                        ? "Turn off to stop automatic replies. The material stays indexed."
                        : "Turn on to answer new messages from the material."
                  }
                >
                  <Switch
                    aria-describedby={
                      blocked ? "agent-untrained-note" : undefined
                    }
                    checked={shown?.isActive ?? false}
                    disabled={!shown || busy || blocked}
                    onCheckedChange={(next) => void toggle(next)}
                  />
                  {shown?.isActive ? "Answering automatically" : "Not answering"}
                </label>

                {blocked ? (
                  <p
                    className="max-w-[15rem] text-right text-[11px] leading-relaxed text-muted-foreground"
                    id="agent-untrained-note"
                  >
                    Add material on the Training tab. An agent with nothing
                    indexed would hand every message back.
                  </p>
                ) : null}
              </div>
            </section>

            <div
              aria-label="Agent sections"
              className="flex flex-wrap gap-1"
              onKeyDown={onTabKeyDown}
              role="tablist"
            >
              {TABS.map((entry) => (
                <button
                  aria-controls={
                    tab === entry.value ? `agent-panel-${entry.value}` : undefined
                  }
                  aria-selected={tab === entry.value}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
                    tab === entry.value
                      ? "bg-secondary text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  id={`agent-tab-${entry.value}`}
                  key={entry.value}
                  onClick={() => setTab(entry.value)}
                  role="tab"
                  tabIndex={tab === entry.value ? 0 : -1}
                  type="button"
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {shown === null ? (
              <div className="grid h-56 place-items-center rounded-xl border border-border bg-card">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div
                aria-labelledby={`agent-tab-${tab}`}
                id={`agent-panel-${tab}`}
                role="tabpanel"
              >
                {tab === "PROMPT" ? (
                  <AgentForm
                    agent={shown}
                    key={shown.id}
                    onSaved={(next) => {
                      // A save that lands after the selection moved on must not
                      // replace the agent being looked at: `shown` would go null
                      // and nothing would re-fetch it.
                      setAgent((current) =>
                        current?.id === next.id ? next : current,
                      );
                      setAgents((current) =>
                        current
                          ? current.map((row) =>
                              row.id === next.id ? next : row,
                            )
                          : current,
                      );
                    }}
                  />
                ) : tab === "TRAINING" ? (
                  <TrainingPanel
                    agent={shown}
                    key={shown.id}
                    onSourcesChanged={reload}
                  />
                ) : (
                  <Playground agent={shown} key={shown.id} />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
