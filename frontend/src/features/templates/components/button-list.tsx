"use client";

import * as React from "react";
import {
  Copy,
  Link2,
  MessageCircle,
  Phone,
  Plus,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import type { TemplateButton, TemplateButtonType } from "../api";
import { variablesOf } from "../format";
import { LIMITS } from "../rules";

/** A button plus the key React needs; `key` never leaves this screen. */
export type DraftButton = TemplateButton & { key: string };

const TYPES: {
  type: TemplateButtonType;
  label: string;
  hint: string;
  icon: LucideIcon;
  cap: number;
}[] = [
  {
    type: "QUICK_REPLY",
    label: "Quick reply",
    hint: "The tap sends this text back to you.",
    icon: MessageCircle,
    cap: LIMITS.quickReplyMax,
  },
  {
    type: "URL",
    label: "Link",
    hint: "Opens a page; may end in {{1}}.",
    icon: Link2,
    cap: LIMITS.urlMax,
  },
  {
    type: "PHONE_NUMBER",
    label: "Call",
    hint: "Starts a call to one number.",
    icon: Phone,
    cap: LIMITS.phoneMax,
  },
  {
    type: "COPY_CODE",
    label: "Copy code",
    hint: "Puts a code on the clipboard.",
    icon: Copy,
    cap: LIMITS.copyCodeMax,
  },
];

const INPUT = cn(
  "mt-1 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-[13px] text-foreground shadow-xs outline-none transition-shadow",
  "placeholder:text-muted-foreground/60",
  "focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]",
);

const LABELS: Record<TemplateButtonType, string> = {
  QUICK_REPLY: "Quick reply",
  URL: "Link",
  PHONE_NUMBER: "Call",
  COPY_CODE: "Copy code",
};

let counter = 0;

function nextKey(): string {
  counter += 1;

  return `button-${counter}`;
}

/**
 * The button editor: add by type, then edit the fields that type needs.
 *
 * Which fields exist is decided by the type, because Meta's payload for a URL
 * button and a copy-code button have nothing in common beyond `type`. Caps are
 * shown on the add tiles and enforced there, so the tenth button cannot be
 * added by accident and then explained by an error.
 */
export function ButtonList({
  buttons,
  onChange,
}: {
  buttons: DraftButton[];
  onChange: (next: DraftButton[]) => void;
}) {
  function add(type: TemplateButtonType) {
    onChange([...buttons, { key: nextKey(), type }]);
  }

  function patch(key: string, changes: Partial<TemplateButton>) {
    onChange(buttons.map((button) => (button.key === key ? { ...button, ...changes } : button)));
  }

  function remove(key: string) {
    onChange(buttons.filter((button) => button.key !== key));
  }

  const atTotal = buttons.length >= LIMITS.buttonsMax;

  return (
    <div className="space-y-4">
      {buttons.length === 0 ? (
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          No buttons. A message can end with up to {LIMITS.buttonsMax}, in any mix
          of the four kinds below.
        </p>
      ) : (
        <ol className="space-y-3">
          {buttons.map((button, index) => (
            <li
              className="rounded-xl border border-border bg-background p-3"
              key={button.key}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Button {index + 1} · {LABELS[button.type]}
                </p>
                <button
                  aria-label={`Remove button ${index + 1}`}
                  className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none"
                  onClick={() => remove(button.key)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </button>
              </div>

              <div className="mt-2.5 space-y-2.5">
                {button.type === "COPY_CODE" ? (
                  <Field
                    hint="Up to 20 characters. WhatsApp labels the button “Copy code” itself."
                    id={`${button.key}-code`}
                    label="Code to copy"
                    max={LIMITS.copyCodeExampleMax}
                    mono
                    onChange={(value) => patch(button.key, { codeExample: value })}
                    placeholder="SAVE20"
                    value={button.codeExample ?? ""}
                  />
                ) : (
                  <Field
                    id={`${button.key}-text`}
                    label="Label"
                    max={LIMITS.buttonTextMax}
                    onChange={(value) => patch(button.key, { text: value })}
                    placeholder={
                      button.type === "QUICK_REPLY"
                        ? "Yes, please"
                        : button.type === "URL"
                          ? "View order"
                          : "Call support"
                    }
                    value={button.text ?? ""}
                  />
                )}

                {button.type === "URL" ? (
                  <>
                    <Field
                      id={`${button.key}-url`}
                      label="Address"
                      mono
                      onChange={(value) => patch(button.key, { url: value })}
                      placeholder="https://shop.example/orders/{{1}}"
                      value={button.url ?? ""}
                    />
                    <Field
                      hint="Meta checks a real address, so it needs the variable filled in."
                      id={`${button.key}-example`}
                      label="Example address"
                      mono
                      onChange={(value) => patch(button.key, { urlExample: value })}
                      placeholder="https://shop.example/orders/1041"
                      value={button.urlExample ?? ""}
                    />
                    <UrlNote url={button.url ?? ""} />
                  </>
                ) : null}

                {button.type === "PHONE_NUMBER" ? (
                  <Field
                    hint="Digits with the country code, no spaces or dashes."
                    id={`${button.key}-phone`}
                    label="Number to dial"
                    mono
                    onChange={(value) => patch(button.key, { phoneNumber: value })}
                    placeholder="+14155550123"
                    value={button.phoneNumber ?? ""}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {TYPES.map((entry) => {
          const Icon = entry.icon;
          const used = buttons.filter((button) => button.type === entry.type).length;
          const blocked = atTotal || used >= entry.cap;

          return (
            <button
              className={cn(
                "flex items-start gap-2.5 rounded-lg border border-dashed border-border px-3 py-2.5 text-left transition-colors",
                "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
                blocked
                  ? "cursor-not-allowed opacity-55"
                  : "hover:border-brand/40 hover:bg-accent",
              )}
              disabled={blocked}
              key={entry.type}
              onClick={() => add(entry.type)}
              type="button"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                <Icon aria-hidden="true" className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                  Add {entry.label.toLowerCase()}
                  <span className="text-[11.5px] font-normal tabular-nums text-muted-foreground">
                    {used}/{entry.cap}
                  </span>
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                  {entry.hint}
                </span>
              </span>
              <Plus aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>

      {atTotal ? (
        <p className="text-[12.5px] text-muted-foreground">
          That is all {LIMITS.buttonsMax} buttons Meta allows on one template.
        </p>
      ) : null}
    </div>
  );
}

/** The one rule the URL field cannot express by a character count. */
function UrlNote({ url }: { url: string }) {
  const variables = variablesOf(url);

  if (variables.length === 0) return null;

  const wrong = variables.some((token) => token !== "1");
  const many = variables.length > 1;

  if (!wrong && !many) return null;

  return (
    <p className="flex items-start gap-1.5 text-[12px] leading-snug text-destructive">
      <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      A link button takes one variable, and it is {"{{1}}"}.
    </p>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  max,
  hint,
  mono,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  max?: number;
  hint?: string;
  mono?: boolean;
}) {
  const over = max !== undefined && value.length > max;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-[12.5px] text-muted-foreground" htmlFor={id}>
          {label}
        </Label>
        {max !== undefined ? (
          <span
            className={cn(
              "text-[11.5px] tabular-nums",
              over ? "font-medium text-destructive" : "text-muted-foreground/70",
            )}
          >
            {value.length}/{max}
          </span>
        ) : null}
      </div>
      <input
        aria-invalid={over ? true : undefined}
        autoCapitalize="off"
        autoComplete="off"
        className={cn(INPUT, mono && "font-mono", over && "border-destructive/60")}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        type="text"
        value={value}
      />
      {hint ? (
        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
