"use client";

import { GripVertical } from "lucide-react";
import { Reorder } from "motion/react";

import { cardLabel, type BotCard } from "@/lib/bots/card";
import { cn } from "@/lib/utils";

/**
 * The agent's cards, in the order the business arranged them.
 *
 * The order belongs to this list alone: a card opens from the button that
 * points at it and the entry is `rootCardId`, so a drag rearranges the editor
 * and changes nothing a customer receives. That is what makes it safe to let
 * the owner move the entry card wherever they like.
 *
 * The whole row is the handle — a row is small, and hunting for a few pixels of
 * grip to drag from is worse than grabbing anywhere on it. A press that ends
 * without moving is a click, so the row still opens its card.
 *
 * Sorting is the library's, keyboard included: Tab to a row, Space to pick it
 * up, the arrow keys to move it, Space to drop, Escape to put it back.
 */
export function CardList({
  cards,
  activeCardId,
  entryCardId,
  disabled,
  onSelect,
  onReorder,
}: {
  cards: BotCard[];
  activeCardId: string | null;
  /** The card the bot starts on, marked so a move cannot be mistaken for it. */
  entryCardId: string | null;
  /** Read-only, or a save in flight: the list is not a handle any more. */
  disabled: boolean;
  onSelect: (id: string) => void;
  onReorder: (ids: string[]) => void;
}) {
  return (
    <Reorder.Group
      axis="y"
      className="mt-2 space-y-1.5"
      onReorder={onReorder}
      values={cards.map((card) => card.id)}
    >
      {cards.map((card) => {
        const active = card.id === activeCardId;
        const entry = card.id === entryCardId;

        return (
          <Reorder.Item
            className={cn(
              // The row itself is the focus target for keyboard sorting, so it
              // has to show that it has focus: the button inside carries the
              // selected state, not the focus.
              "rounded-lg border transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
              active
                ? "border-brand/40 bg-brand-soft/60"
                : "border-transparent hover:bg-accent",
              disabled
                ? "cursor-default"
                : "cursor-grab active:cursor-grabbing",
            )}
            dragListener={!disabled}
            key={card.id}
            value={card.id}
          >
            <button
              aria-pressed={active}
              className="flex w-full items-center gap-2 py-2 pr-2.5 pl-1.5 text-left"
              onClick={() => onSelect(card.id)}
              type="button"
            >
              <GripVertical
                aria-hidden="true"
                className={cn(
                  "size-3.5 shrink-0",
                  disabled ? "opacity-30" : "text-muted-foreground",
                )}
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                {cardLabel(card)}
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
          </Reorder.Item>
        );
      })}
    </Reorder.Group>
  );
}
