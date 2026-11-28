"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRightLeft,
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
  cardLabel,
  emptyFlow,
  newCard,
  newRule,
  reorderCards,
  shiftImpact,
  type BotAction,
  type BotCard,
  type BotFlow,
  type BotRule,
  type ShiftImpact,
} from "@/lib/bots/card";
import { cn } from "@/lib/utils";

import {
  ApiError,
  fetchAgents,
  fetchBot,
  saveBot,
  shiftBot,
  type BotAgent,
  type ShiftMode,
  type ShiftRepairs,
} from "./api";
import { CardEditor } from "./components/card-editor";
import { CardList } from "./components/card-list";
import { RuleList } from "./components/rule-list";

const nav = getNavItem("/workspace/chatbot");

/** A flow as loaded, with the agent it belongs to, so a switch cannot show the wrong one. */
interface Loaded {
  agentId: string;
  stored: BotFlow;
  draft: BotFlow;
}

/**
 * A shift waiting to be confirmed: which cards, to whom, and how.
 *
 * The target is part of the pending shift rather than a separate screen state,
 * so closing the confirmation forgets it too — a half-chosen target cannot be
 * left behind for the next card.
 */
interface PendingShift {
  cardIds: string[];
  targetAgentId: string | null;
  mode: ShiftMode;
}

/** "1 card", "2 cards" — the same phrase in the confirmation and the toast. */
function many(count: number, one: string): string {
  return `${count} ${count === 1 ? one : `${one}s`}`;
}

/**
 * What a shift had to repair, in one sentence, for the toast.
 *
 * Written from the counts the server answered with, not from the
 * confirmation's own estimate: that one was a prediction.
 */
function aftermath(repairs: ShiftRepairs, mode: ShiftMode): string {
  const parts: string[] = [];

  if (mode === "move" && repairs.sourceButtons > 0) {
    parts.push(
      `${many(repairs.sourceButtons, "button")} in this bot changed to handoff`,
    );
  }

  if (mode === "move" && repairs.sourceRules > 0) {
    parts.push(`${many(repairs.sourceRules, "keyword rule")} removed`);
  }

  if (repairs.targetButtons > 0) {
    parts.push(
      `${many(repairs.targetButtons, "button")} on the cards changed to handoff`,
    );
  }

  if (parts.length === 0) {
    return "Nothing else pointed at the cards, so neither bot needed any change.";
  }

  return `Both bots were kept valid: ${parts.join("; ")}.`;
}

/**
 * What the confirmation warns about, in the order it matters.
 *
 * The same counts the server will answer with, read from the draft: the shift
 * has not happened yet, so this is the only place the owner can still change
 * their mind about which cards leave.
 */
function shiftNotes(impact: ShiftImpact, mode: ShiftMode): string[] {
  const notes: string[] = [];

  if (mode === "move" && impact.entryMoves) {
    notes.push(
      "This bot will have no entry card until you choose one: the entry is moving with the card.",
    );
  }

  if (mode === "move" && impact.remaining > 0) {
    notes.push(`This bot keeps ${many(impact.remaining, "card")}.`);
  }

  if (mode === "move" && impact.sourceButtons > 0) {
    notes.push(
      `This bot has ${many(impact.sourceButtons, "button")} that will hand off to a person instead: a button cannot open a card of another bot.`,
    );
  }

  if (mode === "move" && impact.sourceRules > 0) {
    notes.push(
      `This bot has ${many(impact.sourceRules, "keyword rule")} that will be removed, because a rule can only send a card of its own bot.`,
    );
  }

  if (impact.targetButtons > 0) {
    notes.push(
      `The shifted cards have ${many(impact.targetButtons, "button")} that will hand off to a person instead: the card they opened stays in this bot.`,
    );
  }

  if (mode === "copy") {
    notes.push(
      "Keyword rules are not copied: the words that fired these cards still belong to this bot.",
    );
  }

  return notes;
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

  /** The shift being confirmed. Nothing is written until it is confirmed. */
  const [shift, setShift] = React.useState<PendingShift | null>(null);
  const [shifting, setShifting] = React.useState(false);

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

  /** Every agent but this one: a shift never targets the bot it leaves. */
  const otherAgents = (agents ?? []).filter((row) => row.id !== agentId);

  /** Edits always replace the whole flow, so the editor never holds its own copy. */
  function edit(change: (flow: BotFlow) => BotFlow): void {
    // A confirmation names cards and counts repairs read from the draft. Once
    // the draft moves under it, what it promised is no longer what is about to
    // be shifted, so it closes rather than being confirmed against new facts.
    setShift(null);

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
   * The card list's order, and nothing more.
   *
   * A card opens from the button that points at it and the entry is
   * `rootCardId`, so this moves where a card sits in the editor and nowhere a
   * customer can see. It is still an edit: it marks the flow unsaved, and
   * Discard puts the stored order back.
   */
  function reorder(ids: string[]): void {
    if (!canManage || saving) return;

    edit((flow) => ({ ...flow, cards: reorderCards(flow.cards, ids) }));
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

  /**
   * Opens the confirmation for these cards. Nothing is written until it is
   * confirmed: the server edits two flows at once, and the source cannot be
   * put back from this screen.
   *
   * Refused while the draft has unsaved changes, because the server shifts the
   * *saved* cards — the local edit would be quietly replaced by what the shift
   * answers with.
   */
  function beginShift(cardIds: string[]): void {
    if (!canManage || saving || shifting || dirty || otherAgents.length === 0) {
      return;
    }

    setShift({
      cardIds,
      targetAgentId: otherAgents[0]?.id ?? null,
      mode: "move",
    });
  }

  /**
   * The server moves the cards and repairs both flows; the answer is this
   * agent's flow already stored, so the list redraws from it rather than from
   * a local guess at what was repaired.
   */
  async function confirmShift(): Promise<void> {
    const pending = shift;

    if (!pending || !pending.targetAgentId || !agentId || shifting) return;

    setShifting(true);
    setError(null);

    try {
      const result = await shiftBot(agentId, {
        targetAgentId: pending.targetAgentId,
        cardIds: pending.cardIds,
        mode: pending.mode,
      });

      setLoaded({ agentId, stored: result.flow, draft: result.flow });
      setSelectedCardId((current) =>
        current !== null && result.flow.cards.some((card) => card.id === current)
          ? current
          : (result.flow.cards[0]?.id ?? null),
      );
      setShift(null);

      const name =
        agents?.find((row) => row.id === result.targetAgentId)?.name ??
        "the other agent";

      toast.push({
        title: `${many(pending.cardIds.length, "card")} ${
          pending.mode === "move" ? "shifted" : "copied"
        } to ${name}`,
        description: aftermath(result.repairs, pending.mode),
        tone: "success",
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "BOT_STORE_MISSING") {
        setMissingStore(true);
        setShift(null);
        return;
      }

      // The confirmation stays open: a refused shift — a full target, a card
      // that changed under it — is answered by picking another agent, not by
      // starting the whole thing again.
      toast.push({
        title: "Could not shift the cards",
        description:
          caught instanceof ApiError ? caught.message : "Nothing was changed.",
        tone: "error",
      });
    } finally {
      setShifting(false);
    }
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

  // What the confirmation names and what it warns about. Both are read from
  // the draft, not from the server: this is the "before", and the server's
  // answer is what actually happened.
  const movingCards =
    shift === null ? [] : cards.filter((card) => shift.cardIds.includes(card.id));
  const singleMoving = movingCards.length === 1 ? movingCards[0] : null;
  const impact =
    shift && draft ? shiftImpact(draft, shift.cardIds, shift.mode) : null;
  const notes = impact && shift ? shiftNotes(impact, shift.mode) : [];

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
                  onChange={(event) => {
                    // A pending shift belongs to the agent whose cards it names.
                    setShift(null);
                    setAgentId(event.target.value);
                  }}
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
              description="A card is one message: a picture, the information, and up to a few buttons. The first card you add becomes where the bot starts."
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
                    <div className="flex items-center gap-1.5">
                      {canManage && otherAgents.length > 0 && cards.length > 1 ? (
                        <button
                          className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40"
                          disabled={saving || shifting || dirty}
                          onClick={() => beginShift(cards.map((card) => card.id))}
                          title={
                            dirty
                              ? "Save or discard your changes first."
                              : "Shift every card into another agent's bot"
                          }
                          type="button"
                        >
                          <ArrowRightLeft aria-hidden="true" className="size-3.5" />
                          Shift all
                        </button>
                      ) : null}
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
                  </div>

                  {cards.length > 1 ? (
                    <p className="mt-1.5 px-1 text-[11.5px] leading-relaxed text-muted-foreground">
                      {canManage
                        ? "Drag a card to move it up or down — or press Space on one and use the arrow keys. The Entry card is where the bot starts, wherever it sits."
                        : "This is the order the owner arranged. The Entry card is where the bot starts, wherever it sits."}
                    </p>
                  ) : null}

                  {canManage && otherAgents.length > 0 ? (
                    <p className="mt-1 px-1 text-[11.5px] leading-relaxed text-muted-foreground">
                      {dirty
                        ? "Save or discard your changes to shift a card into another agent's bot."
                        : "The arrow beside a card shifts it into another agent's bot, with its pictures, files and buttons."}
                    </p>
                  ) : null}

                  {shift && impact ? (
                    <div className="mt-2 rounded-lg border border-brand/40 bg-brand-soft/40 p-3">
                      <p className="text-[12.5px] font-semibold text-foreground">
                        {singleMoving
                          ? `Shift "${cardLabel(singleMoving)}" to another agent`
                          : `Shift ${many(movingCards.length, "card")} to another agent`}
                      </p>

                      {movingCards.length > 1 ? (
                        <ul className="mt-1.5 max-h-28 list-disc space-y-0.5 overflow-y-auto pl-4 text-[11.5px] leading-relaxed text-muted-foreground">
                          {movingCards.map((card) => (
                            <li key={card.id}>{cardLabel(card)}</li>
                          ))}
                        </ul>
                      ) : null}

                      <div className="mt-2.5 flex flex-wrap items-end gap-3">
                        <label className="min-w-0">
                          <span className="block text-[11px] font-medium text-muted-foreground">
                            Send to
                          </span>
                          <select
                            className="mt-1 block h-8 w-full min-w-44 rounded-lg border border-input bg-background px-2 text-[12.5px] font-medium text-foreground shadow-xs outline-none transition-shadow focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]"
                            disabled={shifting}
                            onChange={(event) =>
                              setShift((current) =>
                                current
                                  ? { ...current, targetAgentId: event.target.value }
                                  : current,
                              )
                            }
                            value={shift.targetAgentId ?? ""}
                          >
                            {otherAgents.map((row) => (
                              <option key={row.id} value={row.id}>
                                {row.name}
                                {row.isActive ? " · answering" : ""}
                              </option>
                            ))}
                          </select>
                        </label>

                        <fieldset
                          className="flex items-center gap-3 pb-1.5"
                          disabled={shifting}
                        >
                          <legend className="sr-only">Move or copy</legend>
                          <label className="flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
                            <input
                              checked={shift.mode === "move"}
                              className="size-3.5 accent-brand"
                              name="shift-mode"
                              onChange={() =>
                                setShift((current) =>
                                  current ? { ...current, mode: "move" } : current,
                                )
                              }
                              type="radio"
                            />
                            Move
                          </label>
                          <label className="flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
                            <input
                              checked={shift.mode === "copy"}
                              className="size-3.5 accent-brand"
                              name="shift-mode"
                              onChange={() =>
                                setShift((current) =>
                                  current ? { ...current, mode: "copy" } : current,
                                )
                              }
                              type="radio"
                            />
                            Copy
                          </label>
                        </fieldset>
                      </div>

                      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                        {shift.mode === "move"
                          ? "The cards leave this bot and join the other one, with their pictures, files and buttons."
                          : "A copy joins the other bot. This one keeps its cards exactly as they are, and the two are edited separately from then on."}
                      </p>

                      <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
                        {notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>

                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <Button
                          disabled={
                            shifting || !shift.targetAgentId || movingCards.length === 0
                          }
                          onClick={() => void confirmShift()}
                          size="sm"
                          type="button"
                          variant="brand"
                        >
                          {shifting ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <ArrowRightLeft />
                          )}
                          {shift.mode === "move" ? "Move" : "Copy"}{" "}
                          {many(movingCards.length, "card")}
                        </Button>
                        <Button
                          disabled={shifting}
                          onClick={() => setShift(null)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Cancel
                        </Button>
                        <span className="text-[11px] leading-relaxed text-muted-foreground">
                          Saved straight away for both agents — not part of Save
                          flow.
                        </span>
                      </div>
                    </div>
                  ) : null}

                  <CardList
                    activeCardId={activeCardId}
                    cards={cards}
                    disabled={!canManage || saving || shifting}
                    entryCardId={draft?.rootCardId ?? null}
                    onReorder={reorder}
                    onSelect={setSelectedCardId}
                    onShift={
                      canManage && otherAgents.length > 0
                        ? (id) => beginShift([id])
                        : undefined
                    }
                    shiftDisabled={!canManage || saving || shifting || dirty}
                  />
                </section>

                {activeCard ? (
                  <section className="rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                      <h2 className="text-sm font-semibold text-foreground">
                        {cardLabel(activeCard)}
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
                      {/* Keyed by agent: the picture gallery and the link field
                          below it are this agent's, so switching agent starts
                          them empty instead of carrying the last one over. */}
                      <CardEditor
                        key={agentId}
                        agentId={agentId}
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
                {/* The card's name is the business's own label and stays in
                    the list: the bubble below is what the customer receives,
                    and it carries the heading, not the name. */}
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
