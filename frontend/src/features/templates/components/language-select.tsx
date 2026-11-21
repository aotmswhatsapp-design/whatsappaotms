"use client";

import * as React from "react";
import { Check, ChevronDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";

import { TEMPLATE_LANGUAGES, languageLabel } from "../languages";

/**
 * Meta's language codes, as a searchable picker.
 *
 * A native select with 111 entries is a scroll, not a choice, and the codes
 * alone (`es_ES`, `es_UY`) are not readable. The panel filters on both the
 * name and the code, so "brazil" and "pt_BR" both land on the same row.
 */
export function LanguageSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const root = React.useRef<HTMLDivElement>(null);
  const search = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;

    function away(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }

    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }

    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    search.current?.focus();

    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? TEMPLATE_LANGUAGES.filter(
        (language) =>
          language.label.toLowerCase().includes(needle) ||
          language.code.toLowerCase().includes(needle),
      )
    : TEMPLATE_LANGUAGES;

  return (
    <div className="relative" ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Template language: ${languageLabel(value)}`}
        className={cn(
          "mt-1.5 flex h-11 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm text-foreground shadow-xs outline-none transition-shadow",
          "focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]",
          disabled && "cursor-not-allowed opacity-60",
        )}
        disabled={disabled}
        onClick={() => {
          setQuery("");
          setOpen((current) => !current);
        }}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate">{languageLabel(value)}</span>
        <span className="font-mono text-[12.5px] text-muted-foreground">{value}</span>
        <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
      </button>

      {open ? (
        <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <input
              aria-label="Search languages"
              className="h-10 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-[13px] placeholder:text-muted-foreground/70"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search a language or a code…"
              ref={search}
              spellCheck={false}
              value={query}
            />
          </div>

          <div
            aria-label="Template language"
            className="max-h-64 overflow-y-auto py-1"
            role="listbox"
          >
            {matches.map((language) => {
              const selected = language.code === value;

              return (
                <button
                  aria-selected={selected}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-[13.5px] transition-colors",
                    "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                    selected && "text-foreground",
                  )}
                  key={language.code}
                  onClick={() => {
                    onChange(language.code);
                    setOpen(false);
                  }}
                  role="option"
                  type="button"
                >
                  <span className="min-w-0 flex-1 truncate">{language.label}</span>
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {language.code}
                  </span>
                  {selected ? (
                    <Check aria-hidden="true" className="size-3.5 text-brand" />
                  ) : (
                    <span aria-hidden="true" className="size-3.5" />
                  )}
                </button>
              );
            })}

            {matches.length === 0 ? (
              <p className="px-3 py-3 text-[13px] text-muted-foreground">
                No language matches “{query.trim()}”.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
