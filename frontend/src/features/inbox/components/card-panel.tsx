"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, Loader2, SendHorizontal } from "lucide-react";

import {
  BotCardPreview,
  shapeNote,
} from "@/components/workspace/bot-card-preview";
import { cardLabel, type BotFlow } from "@/lib/bots/card";

import {
  ApiError,
  fetchAgentCards,
  fetchCardAgents,
  sendCard,
  type CardAgent,
  type Conversation,
  type InboxMessage,
} from "../api";
import type { ComposerMode } from "./mode-switcher";

/**
 * Sending one card of an agent's saved flow.
 *
 * Unlike a template, a card is a reply: it needs the customer's 24-hour window,
 * so `locked` disables the send instead of being ignored. The flow travels with
 * the request, which is what freezes the menu a customer sees against later
 * edits.
 *
 * The agent defaults to the one answering this thread, and falls back to
 * whoever is on duty — an owner often sends the welcome card before the bot has
 * said anything, when the thread has no agent yet.
 */
export function CardPanel({
  conversation,
  locked,
  quotedMessageId,
  onModeChange,
  onSent,
  onSentQuote,
}: {
  conversation: Conversation;
  locked: boolean;
  quotedMessageId?: string | null;
  onModeChange: (mode: ComposerMode) => void;
  /** The card itself, then any pictures sent ahead of it, in delivery order. */
  onSent: (message: InboxMessage, photos?: InboxMessage[]) => void;
  /** Clears the composer's quote, the way a sent sentence does. */
  onSentQuote?: () => void;
}) {
  const [agents, setAgents] = React.useState<CardAgent[] | null>(null);
  const [agentId, setAgentId] = React.useState<string>("");
  const [flow, setFlow] = React.useState<BotFlow | null>(null);
  const [cardId, setCardId] = React.useState("");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [missingTable, setMissingTable] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /** Fetching happens in the promise callbacks only, like the template panel. */
  React.useEffect(() => {
    let active = true;

    fetchCardAgents()
      .then((payload) => {
        if (!active) return;

        setAgents(payload.agents);
        setAgentId((current) => {
          if (current && payload.agents.some((row) => row.id === current)) {
            return current;
          }

          return (
            conversation.agent?.id ??
            payload.agents.find((row) => row.isActive)?.id ??
            payload.agents[0]?.id ??
            ""
          );
        });
      })
      .catch((cause: unknown) => {
        if (!active) return;

        setLoadError(
          cause instanceof ApiError ? cause.message : "Could not load agents.",
        );
      });

    return () => {
      active = false;
    };
  }, [conversation.agent?.id]);

  React.useEffect(() => {
    if (!agentId) return;

    let active = true;

    fetchAgentCards(agentId)
      .then((view) => {
        if (!active) return;

        setFlow(view.flow);
        setCardId((current) =>
          view.flow.cards.some((card) => card.id === current)
            ? current
            : (view.flow.cards[0]?.id ?? ""),
        );
        setMissingTable(false);
        setLoadError(null);
      })
      .catch((cause: unknown) => {
        if (!active) return;

        if (cause instanceof ApiError && cause.code === "BOT_STORE_MISSING") {
          setMissingTable(true);
          return;
        }

        setLoadError(
          cause instanceof ApiError ? cause.message : "Could not load cards.",
        );
      });

    return () => {
      active = false;
    };
  }, [agentId]);

  const card = flow?.cards.find((row) => row.id === cardId) ?? null;
  const ready = card !== null && !locked && !busy;

  async function submit(): Promise<void> {
    if (!card || !flow || !ready) return;

    setBusy(true);
    setError(null);

    try {
      const { message, photos } = await sendCard(
        conversation.id,
        flow,
        card.id,
        quotedMessageId,
      );

      onSent(message, photos);
      onSentQuote?.();
      onModeChange("reply");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not send that card. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Send a chatbot card"
      className="rounded-xl border border-border bg-card p-2"
    >
      {/* The composer owns the way back to a sentence and the mode switch;
          this panel is only the flow's own picker and preview. */}
      <div className="space-y-1.5">
        {missingTable ? (
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            The chatbot table is not installed on this database yet. The{" "}
            <Link
              className="font-medium text-brand underline-offset-2 hover:underline"
              href="/workspace/chatbot"
            >
              Chatbot page
            </Link>{" "}
            names the file that installs it.
          </p>
        ) : null}

        {loadError ? (
          <p className="rounded-lg bg-destructive/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-destructive">
            {loadError}
          </p>
        ) : null}

        {agents !== null && agents.length === 0 ? (
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            No agent has a flow yet.{" "}
            <Link
              className="font-medium text-brand underline-offset-2 hover:underline"
              href="/workspace/chatbot"
            >
              Build one first
            </Link>
            .
          </p>
        ) : null}

        {agents !== null && agents.length > 0 ? (
          <div className="grid gap-1.5 sm:grid-cols-2">
            <SelectField
              label="Agent"
              name="card-agent"
              value={agentId}
              disabled={busy}
              onChange={(value) => {
                setAgentId(value);
                setFlow(null);
                setCardId("");
                setError(null);
              }}
            >
              {agents.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="Card"
              name="card"
              value={cardId}
              disabled={busy || !flow || flow.cards.length === 0}
              onChange={(value) => {
                setCardId(value);
                setError(null);
              }}
            >
              {flow === null || flow.cards.length === 0 ? (
                <option value="">No saved cards</option>
              ) : (
                flow.cards.map((row) => (
                  <option key={row.id} value={row.id}>
                    {cardLabel(row)}
                  </option>
                ))
              )}
            </SelectField>
          </div>
        ) : null}

        {flow === null &&
        agentId !== "" &&
        !missingTable &&
        !loadError ? (
          <p className="flex h-8 items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            Loading this agent&apos;s cards…
          </p>
        ) : null}

        {flow !== null && flow.cards.length === 0 ? (
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            This agent has no saved cards.{" "}
            <Link
              className="font-medium text-brand underline-offset-2 hover:underline"
              href="/workspace/chatbot"
            >
              Write one on the Chatbot page
            </Link>
            .
          </p>
        ) : null}
      </div>

      {card ? (
        <div className="mt-2">
          <p className="mb-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Preview
          </p>
          <BotCardPreview card={card} />
          {/* The bubble draws the card's cover even though the rest of the
              pictures arrive as their own messages; saying so keeps the
              preview from promising an album WhatsApp does not have. */}
          {card.imageUrls.length > 0 ? (
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
              {shapeNote(card)}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 mt-2 flex flex-wrap items-center justify-between gap-2 bg-card pt-1">
        <p className="min-w-0 text-[10px] leading-relaxed text-muted-foreground">
          {locked
            ? "The 24-hour window has closed; a card cannot reopen it."
            : "The customer receives the previewed card as it stands."}
        </p>
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-brand px-3 text-[11.5px] font-semibold text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          disabled={!ready}
          onClick={() => void submit()}
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <SendHorizontal aria-hidden="true" className="size-3.5" />
          )}
          Send card
        </button>
      </div>
    </section>
  );
}

/** A labelled select with the panel's own arrow, like the template picker. */
function SelectField({
  label,
  name,
  value,
  disabled,
  onChange,
  children,
}: {
  label: string;
  name: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="relative block min-w-0">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="h-8 w-full min-w-0 appearance-none truncate rounded-lg border border-border bg-secondary pr-7 pl-2.5 text-[11.5px] font-medium text-foreground outline-none transition-colors focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:opacity-60"
        disabled={disabled}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </label>
  );
}
