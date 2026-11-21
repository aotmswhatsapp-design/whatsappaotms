"use client";

import * as React from "react";
import { LayoutTemplate, SendHorizontal, StickyNote } from "lucide-react";

import { cn } from "@/lib/utils";

export type ComposerMode = "reply" | "note" | "template";

/**
 * Reply · Note · Template.
 *
 * Template is never disabled by the reply window: a template is the one
 * message WhatsApp lets a business send after the customer has gone quiet.
 */
export function ModeSwitcher({
  mode,
  locked,
  onChange,
  className,
}: {
  mode: ComposerMode;
  locked: boolean;
  onChange: (mode: ComposerMode) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Message type"
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-full bg-secondary p-0.5",
        className,
      )}
    >
      <ModeButton
        active={mode === "reply"}
        disabled={locked}
        onClick={() => onChange("reply")}
        icon={<SendHorizontal aria-hidden="true" className="size-3.5" />}
        label="Reply"
        title={locked ? "The customer has not written for 24 hours." : undefined}
      />
      <ModeButton
        active={mode === "note"}
        onClick={() => onChange("note")}
        icon={<StickyNote aria-hidden="true" className="size-3.5" />}
        label="Note"
      />
      <ModeButton
        active={mode === "template"}
        onClick={() => onChange("template")}
        icon={<LayoutTemplate aria-hidden="true" className="size-3.5" />}
        label="Template"
        title="Send an approved template, even after the 24-hour window."
      />
    </div>
  );
}

function ModeButton({
  active,
  label,
  icon,
  onClick,
  disabled,
  title,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors sm:px-2.5",
        active
          ? "bg-card text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-40",
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {icon}
      {/* The icon alone carries the control below `sm`; the label stays in the
          tree so the button keeps a real name for screen readers. */}
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
}
