"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  newButton,
  type BotAction,
  type BotActionKind,
  type BotButton,
  type BotCard,
  type BotFlow,
} from "@/lib/bots/card";
import { BODY_CHARS, BUTTON_TITLE, HEADER_CHARS, TEXT_CHARS } from "@/lib/bots/limits";
import { CardImageField } from "./card-image-field";

const FIELD =
  "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-[12.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60";

const KIND_LABEL: Record<BotActionKind, string> = {
  card: "Open another card",
  link: "Open a link",
  handoff: "Hand off to a person",
  text: "Answer with a sentence",
};

/**
 * One card, as a form.
 *
 * Every change produces a whole new card, so the parent keeps one copy of the
 * flow and nothing here can leave half a card behind. The ids are never
 * editable: a tap is routed by the id, and a renamed label must not break a
 * flow that already points at it.
 */
export function CardEditor({
  agentId,
  flow,
  card,
  disabled,
  onChange,
  onDelete,
}: {
  /**
   * The agent whose flow this is, from the screen rather than from the flow
   * document: the picture gallery is that agent's folder, and a flow that
   * named somebody else must never list their uploads here.
   */
  agentId: string;
  flow: BotFlow;
  card: BotCard;
  disabled: boolean;
  onChange: (next: BotCard) => void;
  onDelete: () => void;
}) {
  function patch(changes: Partial<BotCard>): void {
    onChange({ ...card, ...changes });
  }

  /** Every card but this one: a button that only reopens its own card is refused. */
  const otherCards = flow.cards.filter((row) => row.id !== card.id);

  function patchButton(id: string, changes: Partial<BotButton>): void {
    patch({
      buttons: card.buttons.map((button) =>
        button.id === id ? { ...button, ...changes } : button,
      ),
    });
  }

  function setKind(button: BotButton, kind: BotActionKind): void {
    const action: BotAction =
      kind === "card"
        ? { kind, cardId: otherCards[0]?.id ?? "" }
        : kind === "link"
          ? { kind, url: "" }
          : kind === "text"
            ? { kind, body: "" }
            : { kind: "handoff" };

    patchButton(button.id, { action });
  }

  const overInfo = card.info.length > BODY_CHARS;

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <Label htmlFor="card-title">Name</Label>
        <input
          id="card-title"
          className={cn(FIELD, "mt-1.5")}
          disabled={disabled}
          maxLength={HEADER_CHARS}
          placeholder="Menu"
          spellCheck
          value={card.title}
          onChange={(event) => patch({ title: event.target.value })}
        />
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          The header when there is no picture — or when the pictures travel
          separately. {card.title.length}/{HEADER_CHARS}
        </p>
      </div>

      <div>
        <p className="text-[13px] font-medium text-foreground">Pictures</p>
        <div className="mt-1.5">
          <CardImageField
            agentId={agentId}
            cardId={card.id}
            disabled={disabled}
            // This card is left out: removing a picture it sends is how the
            // card goes back to having fewer. The others are the ones a
            // delete would leave pointing at nothing.
            usedBy={(url) =>
              flow.cards
                .filter((other) => other.id !== card.id && other.imageUrls.includes(url))
                .map((other) => other.title.trim() || "An untitled card")
            }
            value={card.imageUrls}
            onChange={(urls) => patch({ imageUrls: urls })}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="card-info">Information</Label>
        <textarea
          id="card-info"
          className={cn(FIELD, "mt-1.5 min-h-28 resize-y leading-relaxed")}
          disabled={disabled}
          placeholder={"Dosa 80\nIdli 40\nFilter coffee 30"}
          value={card.info}
          onChange={(event) => patch({ info: event.target.value })}
        />
        <p
          className={cn(
            "mt-1 text-[11px] leading-relaxed",
            overInfo ? "text-destructive" : "text-muted-foreground",
          )}
        >
          The body of the message. {card.info.length}/{BODY_CHARS}
          {overInfo ? " — WhatsApp will not take a body this long." : ""}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-foreground">Buttons</p>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40"
            disabled={disabled}
            onClick={() =>
              patch({ buttons: [...card.buttons, newButton()] })
            }
          >
            <Plus aria-hidden="true" className="size-3.5" />
            Add
          </button>
        </div>

        {card.buttons.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            No buttons yet, so this card arrives as plain text. A button is what
            lets the customer choose. Pictures are still sent, each on its own,
            before it.
          </p>
        ) : null}

        <div className="mt-2 space-y-2">
          {card.buttons.map((button, at) => (
            <div
              className="rounded-lg border border-border bg-secondary/40 p-2.5"
              key={button.id}
            >
              <div className="flex items-start gap-2">
                <span className="mt-1.5 w-4 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground">
                  {at + 1}
                </span>
                <input
                  aria-label={`Button ${at + 1} label`}
                  className={cn(FIELD, "min-w-0 flex-1")}
                  disabled={disabled}
                  maxLength={BUTTON_TITLE}
                  placeholder="Drinks"
                  value={button.label}
                  onChange={(event) =>
                    patchButton(button.id, { label: event.target.value })
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove button ${at + 1}`}
                  className="mt-1 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  disabled={disabled}
                  onClick={() =>
                    patch({
                      buttons: card.buttons.filter((row) => row.id !== button.id),
                    })
                  }
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </button>
              </div>

              <div className="mt-1.5 grid gap-1.5 pl-6 sm:grid-cols-2">
                <label className="min-w-0">
                  <span className="sr-only">What button {at + 1} does</span>
                  <select
                    className={FIELD}
                    disabled={disabled}
                    value={button.action.kind}
                    onChange={(event) =>
                      setKind(button, event.target.value as BotActionKind)
                    }
                  >
                    {(Object.keys(KIND_LABEL) as BotActionKind[]).map((kind) => (
                      <option key={kind} value={kind}>
                        {KIND_LABEL[kind]}
                      </option>
                    ))}
                  </select>
                </label>

                {button.action.kind === "card" ? (
                  <label className="min-w-0">
                    <span className="sr-only">Which card</span>
                    <select
                      className={FIELD}
                      disabled={disabled || otherCards.length === 0}
                      value={button.action.cardId}
                      onChange={(event) =>
                        patchButton(button.id, {
                          action: { kind: "card", cardId: event.target.value },
                        })
                      }
                    >
                      {otherCards.length === 0 ? (
                        <option value="">Add another card first</option>
                      ) : (
                        otherCards.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.title.trim() || "Untitled card"}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                ) : null}

                {button.action.kind === "link" ? (
                  <label className="min-w-0">
                    <span className="sr-only">The address</span>
                    <input
                      className={FIELD}
                      disabled={disabled}
                      inputMode="url"
                      placeholder="https://…"
                      spellCheck={false}
                      value={button.action.url}
                      onChange={(event) =>
                        patchButton(button.id, {
                          action: { kind: "link", url: event.target.value },
                        })
                      }
                    />
                  </label>
                ) : null}

                {button.action.kind === "text" ? (
                  <label className="min-w-0">
                    <span className="sr-only">The sentence</span>
                    <input
                      className={FIELD}
                      disabled={disabled}
                      maxLength={TEXT_CHARS}
                      placeholder="We are open until 10pm."
                      value={button.action.body}
                      onChange={(event) =>
                        patchButton(button.id, {
                          action: { kind: "text", body: event.target.value },
                        })
                      }
                    />
                  </label>
                ) : null}
              </div>

              {button.label.trim().length === 0 ? (
                <p className="mt-1.5 pl-6 text-[10.5px] leading-relaxed text-muted-foreground">
                  A button with no label is not shown to the customer.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Removing a card also clears any button that pointed at it.
        </p>
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border px-2.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-40"
          disabled={disabled}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
          Remove card
        </button>
      </div>
    </div>
  );
}
