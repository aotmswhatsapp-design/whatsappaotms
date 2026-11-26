"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bot,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Undo2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  BotCardPreview,
  shapeNote,
} from "@/components/workspace/bot-card-preview";
import { EmptyState } from "@/components/workspace/empty-state";
import { PageHeader } from "@/components/workspace/page-header";
import { getNavItem } from "@/config/workspace-nav";
import { useWorkspaceRole } from "@/hooks/use-workspace-role";
import {
  emptyFlow,
  newCard,
  newRule,
  type BotAction,
  type BotCard,
  type BotFlow,
  type BotRule,
} from "@/lib/bots/card";
import { cn } from "@/lib/utils";

import { ApiError, fetchAgents, fetchBot, saveBot, type BotAgent } from "./api";
import { CardEditor } from "./components/card-editor";
import { RuleList } from "./components/rule-list";

const nav = getNavItem("/workspace/chatbot");

/** A flow as loaded, with the agent it belongs to, so a switch cannot show the wrong one. */
interface Loaded {
  agentId: string;
  stored: BotFlow;
  draft: BotFlow;
}

/**
 * The chatbot screen: one flow per agent — its cards, the keyword rules that
 * answer on their own, and the picture of what a customer will actually
 * receive.
 *
 * Two ways a customer meets this bot. A rule fires from an inbound message with
 * nobody present: "hi" gets the welcome card and the assistant stays quiet. A
 * card can also be sent by hand into a conversation from the Inbox, and the taps
 * under it are answered by the same router.
 *
 * Writing is the owner's, server-side. The role is read here for the same
 * reason: a control that always answers 403 is worse than no control. While the
 * role is unknown — loading, or the read failed — the flow stays read-only.
 */
export function ChatbotView() {
  const toast = useToast();
  const {
    role,
    status: roleStatus,
    retry: retryRole,
  } = useWorkspaceRole();
  const canManage = role === "OWNER";

  const roleNote =
    roleStatus === "loading"
      ? "Checking your permissions…"
      : roleStatus === "failed"
        ? "Your role could not be read just now. Use Retry permissions above; nothing on this screen is lost."
        : role === "ADMIN"
          ? "Read-only. You are a manager in this workspace; only its owner can change the chatbot."
          : "Read-only. You are a support agent in this workspace; only its owner can change the chatbot.";

  const [agents, setAgents] = React.useState<BotAgent[] | null>(null);
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [selectedCardId, setSelectedCardId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  /**
   * True when the database is one migration behind. Not an error: the screen
   * is finished and the table is a proposal, so the honest answer names the
   * file rather than blaming the request.
   */
  const [missingStore, setMissingStore] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    fetchAgents()
      .then((next) => {
        if (!active) return;

        setAgents(next.agents);
        setError(null);
        setAgentId((current) => {
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

  // The previous flow stays in `loaded` on purpose: `shown` already requires a
  // matching agent id, so a switch shows the skeleton until its own flow lands
  // rather than the last agent's cards under a new name.
  React.useEffect(() => {
    if (!agentId) return;

    let active = true;

    fetchBot(agentId)
      .then((view) => {
        if (!active) return;

        setLoaded({ agentId, stored: view.flow, draft: view.flow });
        setSelectedCardId(view.flow.cards[0]?.id ?? null);
        setMissingStore(false);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;

        if (caught instanceof ApiError && caught.code === "BOT_STORE_MISSING") {
          setMissingStore(true);
          return;
        }

        setError(
          caught instanceof ApiError
            ? caught.message
            : "This chatbot flow could not be read.",
        );
      });

    return () => {
      active = false;
    };
  }, [agentId, attempt]);

  const reload = React.useCallback(() => {
    setLoading(true);
    setAttempt((count) => count + 1);
  }, []);

  const shown = loaded && loaded.agentId === agentId ? loaded : null;
  const draft = shown?.draft ?? null;
  const dirty =
    shown !== null && JSON.stringify(shown.draft) !== JSON.stringify(shown.stored);

  /** Edits always replace the whole flow, so the editor never holds its own copy. */
  function edit(change: (flow: BotFlow) => BotFlow): void {
    setLoaded((current) =>
      current && current.agentId === agentId
        ? { ...current, draft: change(current.draft) }
        : current,
    );
  }

  function addCard(): void {
    const card = newCard();

    edit((flow) => ({
      ...flow,
      // The first card becomes the entry point: a flow with no entry cannot
      // greet anyone, and asking for a second click to say so adds nothing.
      rootCardId: flow.rootCardId ?? card.id,
      cards: [...flow.cards, card],
    }));
    setSelectedCardId(card.id);
  }

  function updateCard(next: BotCard): void {
    edit((flow) => ({
      ...flow,
      cards: flow.cards.map((card) => (card.id === next.id ? next : card)),
    }));
  }

  /**
   * Removing a card repairs what pointed at it.
   *
   * The server refuses a button that opens a card outside the flow, so leaving
   * the reference behind would make the whole flow unsavable until the owner
   * found the one broken button. Handing off to a person is the safe landing:
   * it is the one action that cannot point anywhere wrong. A rule that replied
   * with the card goes with it for the same reason — a rule with no card can
   * never answer, and the server will not save one.
   */
  function removeCard(id: string): void {
    edit((flow) => ({
      ...flow,
      rootCardId: flow.rootCardId === id ? null : flow.rootCardId,
      rules: flow.rules.filter((rule) => rule.replyCardId !== id),
      cards: flow.cards
        .filter((card) => card.id !== id)
        .map((card) => ({
          ...card,
          buttons: card.buttons.map((button) => {
            const action: BotAction | null =
              button.action.kind === "card" && button.action.cardId === id
                ? { kind: "handoff" }
                : null;

            return action ? { ...button, action } : button;
          }),
        })),
    }));
  }

  function addRule(): void {
    const first = draft?.cards[0];

    // A rule needs a card to send, and the cards section is where one comes
    // from. The button is disabled until there is one; this is the guard.
    if (!first) return;

    edit((flow) => ({ ...flow, rules: [...flow.rules, newRule(first.id)] }));
  }

  function updateRule(next: BotRule): void {
    edit((flow) => ({
      ...flow,
      rules: flow.rules.map((rule) => (rule.id === next.id ? next : rule)),
    }));
  }

  function removeRule(id: string): void {
    edit((flow) => ({
      ...flow,
      rules: flow.rules.filter((rule) => rule.id !== id),
    }));
  }

  function discard(): void {
    if (!shown) return;

    setLoaded({ ...shown, draft: shown.stored });
    setSelectedCardId(shown.stored.cards[0]?.id ?? null);
  }

  async function save(): Promise<void> {
    if (!shown || !agentId || !canManage || saving) return;

    setSaving(true);
    setError(null);

    try {
      const view = await saveBot(agentId, shown.draft);

      setLoaded({ agentId, stored: view.flow, draft: view.flow });
      setMissingStore(false);

      toast.push({
        title: "Flow saved",
        description:
          view.flow.cards.length === 0
            ? "This agent now has an empty flow, so the Inbox offers no cards for it."
            : view.flow.rules.length > 0
              ? "Its rules now answer on their own, and any card can still be sent from the Inbox."
              : "Send any of its cards from the Inbox, on the Chatbot tab of the reply box.",
        tone: "success",
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "BOT_STORE_MISSING") {
        setMissingStore(true);
        return;
      }

      toast.push({
        title: "Could not save the flow",
        description:
          caught instanceof ApiError ? caught.message : "Nothing was saved.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  const cards = draft?.cards ?? [];
  const activeCardId = cards.some((card) => card.id === selectedCardId)
    ? selectedCardId
    : (cards[0]?.id ?? null);
  const activeCard = cards.find((card) => card.id === activeCardId) ?? null;

  const selectedAgent = agents?.find((row) => row.id === agentId) ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        actions={
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
        }
        description="The cards a customer can walk through, and the words that answer on their own. A rule sends its card the moment a message matches; a card sent from the Inbox is followed by taps on its buttons, which move to the next card, open a link, or put a person in the thread."
        eyebrow={nav.group}
        title={nav.title}
      />

      {roleStatus === "failed" ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5">
          <p className="text-[12.5px] leading-relaxed text-foreground">
            Your role in this workspace could not be read, so the editor stays
            locked. This is usually a dropped request, not a permissions change.
          </p>
          <Button
            className="mt-2"
            onClick={retryRole}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw />
            Retry permissions
          </Button>
        </div>
      ) : null}

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

      {missingStore ? (
        <section className="rounded-xl border border-warning/40 bg-warning/5 p-4">
          <h2 className="text-[13px] font-semibold text-foreground">
            This database is missing the chatbot table
          </h2>
          <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-foreground">
            This editor saves to a <code className="font-mono text-[11.5px]">bot_flows</code>{" "}
            table. The code is in place and the migration is written; this
            database has not run it yet.
          </p>
          <ol className="mt-2.5 max-w-2xl list-decimal space-y-1 pl-4 text-[12.5px] leading-relaxed text-muted-foreground">
            <li>
              From{" "}
              <code className="font-mono text-[11.5px] text-foreground">Backend/</code>, run{" "}
              <code className="font-mono text-[11.5px] text-foreground">
                npx prisma migrate deploy
              </code>
              .
            </li>
            <li>
              That applies{" "}
              <code className="font-mono text-[11.5px]">prisma/migrations/0025_bot_flows</code>{" "}
              — one new table, nothing that already exists is touched.
            </li>
            <li>Reload this screen. The editor opens on the saved flow, if any.</li>
          </ol>
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Nothing here writes until the table exists, and a migration that has
            run cannot be undone from this screen.
          </p>
        </section>
      ) : null}

      {!missingStore && loading && agents === null ? (
        <div className="grid h-56 place-items-center rounded-xl border border-border bg-card">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {!missingStore && agents !== null && agents.length === 0 ? (
        <EmptyState
          description="A chatbot belongs to an agent, and this workspace has none yet. Create one on the AI assistant page first — a flow with nobody to answer it has nowhere to live."
          icon={Bot}
          title="No agent to attach a chatbot to"
          action={
            <Button asChild size="sm" variant="brand">
              <Link href="/workspace/ai">Go to the AI assistant</Link>
            </Button>
          }
        />
      ) : null}

      {!missingStore && agents !== null && agents.length > 0 && agentId ? (
        <>
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="min-w-0">
                <span className="text-[11.5px] font-medium text-muted-foreground">
                  Agent
                </span>
                <select
                  className="mt-1 block h-9 w-full min-w-56 rounded-lg border border-input bg-background px-2.5 text-[13px] font-medium text-foreground shadow-xs outline-none transition-shadow focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]"
                  disabled={saving || dirty}
                  onChange={(event) => setAgentId(event.target.value)}
                  value={agentId}
                >
                  {(agents ?? []).map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                      {row.isActive ? " · answering" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                {dirty ? (
                  <Button
                    disabled={saving}
                    onClick={discard}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Undo2 />
                    Discard
                  </Button>
                ) : null}
                <Button
                  disabled={!canManage || !dirty || saving}
                  onClick={() => void save()}
                  size="sm"
                  type="button"
                  variant="brand"
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Save />}
                  Save flow
                </Button>
              </div>
            </div>

            <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
              {!canManage
                ? roleNote
                : dirty
                  ? "Unsaved changes. A customer sees the last saved flow until you save this one."
                  : shown === null
                    ? "Reading this agent's flow…"
                    : shown.stored.cards.length === 0
                      ? `Nothing saved for ${selectedAgent?.name ?? "this agent"} yet. The Inbox has no cards to send until you save at least one.`
                      : "Saved. Send any card from the Inbox, on the Chatbot tab of the reply box."}
            </p>
            {dirty && canManage ? (
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Switching agent discards the unsaved changes.
              </p>
            ) : null}
          </section>

          {shown === null ? (
            <div className="grid h-56 place-items-center rounded-xl border border-border bg-card">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : cards.length === 0 ? (
            <EmptyState
              description="A card is one message: a picture, the information, and up to a few buttons. The first card is where the bot starts."
              icon={MessageSquare}
              title="No cards yet"
              action={
                canManage ? (
                  <Button onClick={addCard} size="sm" type="button" variant="brand">
                    <Plus />
                    Add the first card
                  </Button>
                ) : (
                  <p className="text-[11.5px] text-muted-foreground">{roleNote}</p>
                )
              }
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <div className="space-y-4">
                <RuleList
                  disabled={!canManage || saving}
                  flow={draft ?? emptyFlow(agentId)}
                  onAdd={addRule}
                  onChange={updateRule}
                  onEditCard={setSelectedCardId}
                  onRemove={removeRule}
                />

                <section className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <h2 className="text-sm font-semibold text-foreground">
                      Cards{" "}
                      <span className="font-normal text-muted-foreground">
                        ({cards.length})
                      </span>
                    </h2>
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40"
                      disabled={!canManage}
                      onClick={addCard}
                    >
                      <Plus aria-hidden="true" className="size-3.5" />
                      Add card
                    </button>
                  </div>

                  <ul className="mt-2 space-y-1.5">
                    {cards.map((card) => {
                      const active = card.id === activeCardId;
                      const entry = draft?.rootCardId === card.id;

                      return (
                        <li key={card.id}>
                          <button
                            type="button"
                            aria-pressed={active}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                              active
                                ? "border-brand/40 bg-brand-soft/60"
                                : "border-transparent hover:bg-accent",
                            )}
                            onClick={() => setSelectedCardId(card.id)}
                          >
                            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                              {card.title.trim() || "Untitled card"}
                            </span>
                            {entry ? (
                              <span className="shrink-0 rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                                Entry
                              </span>
                            ) : null}
                            <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                              {card.buttons.length}{" "}
                              {card.buttons.length === 1 ? "button" : "buttons"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>

                {activeCard ? (
                  <section className="rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                      <h2 className="text-sm font-semibold text-foreground">
                        {activeCard.title.trim() || "Untitled card"}
                      </h2>
                      <label className="flex items-center gap-2 text-[11.5px] font-medium text-foreground">
                        <input
                          checked={draft?.rootCardId === activeCard.id}
                          className="size-3.5 accent-brand"
                          disabled={!canManage}
                          type="radio"
                          onChange={() =>
                            edit((flow) => ({
                              ...flow,
                              rootCardId: activeCard.id,
                            }))
                          }
                        />
                        Where the bot starts
                      </label>
                    </div>

                    <div className="mt-3">
                      <CardEditor
                        card={activeCard}
                        disabled={!canManage || saving}
                        flow={draft ?? emptyFlow(agentId)}
                        onChange={updateCard}
                        onDelete={() => removeCard(activeCard.id)}
                      />
                    </div>
                  </section>
                ) : null}
              </div>

              <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
                <p className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  Preview
                </p>
                {activeCard ? (
                  <>
                    <BotCardPreview card={activeCard} />
                    <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                      {shapeNote(activeCard)}
                    </p>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
