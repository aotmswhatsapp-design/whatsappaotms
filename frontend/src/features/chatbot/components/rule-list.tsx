"use client";

import { Trash2 } from "lucide-react";

import type { BotFlow, BotRule } from "@/lib/bots/card";
import { triggerText, triggersOf } from "@/lib/bots/card";
import { cn } from "@/lib/utils";

/**
 * "When the customer says this, send that" — the rules of one agent.
 *
 * A rule points at a card of the same flow instead of holding its own copy of a
 * message, so editing the card edits every rule that sends it. Order matters
 * and is the stored order: the engine takes the first match, which is how a
 * business puts "refund" above "hi".
 *
 * The trigger box commits on blur rather than on every keystroke. Parsing
 * "hi, hello" as it is typed would eat the comma the moment it is pressed —
 * "hi," parses to ["hi"], and redrawing the field from that would delete the
 * character that was just entered.
 */
export function RuleList({
  flow,
  disabled,
  onAdd,
  onChange,
  onRemove,
  onEditCard,
}: {
  flow: BotFlow;
  disabled: boolean;
  onAdd: () => void;
  onChange: (rule: BotRule) => void;
  onRemove: (id: string) => void;
  onEditCard: (cardId: string) => void;
}) {
  const rules = flow.rules;

  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold text-foreground">
          Rules{" "}
          <span className="font-normal text-muted-foreground">({rules.length})</span>
        </h2>
        <button
          className="inline-flex h-7 items-center rounded-full border border-border px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40"
          disabled={disabled}
          onClick={onAdd}
          type="button"
        >
          Add rule
        </button>
      </div>

      <p className="mt-1.5 px-1 text-[11.5px] leading-relaxed text-muted-foreground">
        Matched on whole words, first rule first. A match answers with its card
        and the assistant stays quiet for that message.
      </p>

      {rules.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
          No rules yet. Add one to greet a customer who says{" "}
          <span className="font-medium text-foreground">hi</span>.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rules.map((rule) => {
            const card = flow.cards.find((row) => row.id === rule.replyCardId);

            return (
              <li
                className={cn(
                  "rounded-lg border border-border p-2.5",
                  rule.enabled ? null : "opacity-60",
                )}
                key={rule.id}
              >
                <div className="flex items-start gap-2">
                  <label className="mt-4 flex shrink-0 items-center">
                    <input
                      aria-label="Rule is on"
                      checked={rule.enabled}
                      className="size-3.5 accent-brand"
                      disabled={disabled}
                      onChange={(event) =>
                        onChange({ ...rule, enabled: event.target.checked })
                      }
                      type="checkbox"
                    />
                  </label>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <label className="block">
                      <span className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                        Customer says
                      </span>
                      <input
                        className="mt-0.5 block h-8 w-full rounded-lg border border-input bg-background px-2 text-[12.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px] disabled:opacity-60"
                        defaultValue={triggerText(rule)}
                        disabled={disabled}
                        // Remounts only when the stored triggers change from
                        // elsewhere — a discard, or a save — never mid-typing.
                        key={triggerText(rule)}
                        onBlur={(event) =>
                          onChange({ ...rule, triggers: triggersOf(event.target.value) })
                        }
                        placeholder="hi, hello, hey"
                      />
                    </label>

                    <label className="block">
                      <span className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                        Reply with
                      </span>
                      <select
                        className="mt-0.5 block h-8 w-full rounded-lg border border-input bg-background px-2 text-[12.5px] font-medium text-foreground shadow-xs outline-none transition-shadow focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px] disabled:opacity-60"
                        disabled={disabled}
                        onChange={(event) =>
                          onChange({ ...rule, replyCardId: event.target.value })
                        }
                        value={rule.replyCardId}
                      >
                        {flow.cards.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.title.trim() || "Untitled card"}
                          </option>
                        ))}
                      </select>
                    </label>

                    {card ? (
                      <button
                        className="text-[11px] font-medium text-brand underline-offset-2 hover:underline"
                        onClick={() => onEditCard(card.id)}
                        type="button"
                      >
                        Edit this card
                      </button>
                    ) : null}
                  </div>

                  <button
                    aria-label="Remove this rule"
                    className="mt-3.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                    disabled={disabled}
                    onClick={() => onRemove(rule.id)}
                    type="button"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
