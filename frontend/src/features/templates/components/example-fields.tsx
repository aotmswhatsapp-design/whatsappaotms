"use client";

import { Label } from "@/components/ui/label";

import type { ParameterFormat } from "../api";

/**
 * One example per variable. Meta refuses a template whose variables have no
 * sample, so this is part of the message rather than a preview extra — which
 * is why it sits between the content and the buttons, in submission order.
 */
export function ExampleFields({
  tokens,
  examples,
  format,
  onChange,
}: {
  tokens: string[];
  examples: Record<string, string>;
  format: ParameterFormat;
  onChange: (token: string, value: string) => void;
}) {
  return (
    <div className="space-y-2.5">
      {tokens.map((token, index) => {
        const id = `template-example-${index}`;
        const value = examples[token] ?? "";

        return (
          <div
            className="sm:grid sm:grid-cols-[140px_minmax(0,1fr)] sm:items-center sm:gap-3"
            key={token}
          >
            <Label className="font-mono text-[13px] text-foreground" htmlFor={id}>
              {`{{${token}}}`}
            </Label>
            <input
              autoComplete="off"
              className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-[13.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px] sm:mt-0"
              id={id}
              onChange={(event) => onChange(token, event.target.value)}
              placeholder={
                format === "POSITIONAL" ? "What a customer would see" : "e.g. Amina"
              }
              spellCheck={false}
              type="text"
              value={value}
            />
          </div>
        );
      })}
    </div>
  );
}
