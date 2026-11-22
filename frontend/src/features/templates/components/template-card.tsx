import * as React from "react";
import Link from "next/link";
import { CircleAlert, FileText, ImageIcon, Video } from "lucide-react";

import { TemplateImage } from "@/components/workspace/template-image";
import { cn } from "@/lib/utils";

import type { TemplateFacts } from "../api";
import { templateParts, type TemplateButtonFact } from "../components-shape";
import {
  categoryLabel,
  statusLabel,
  statusTone,
  updatedLabel,
  type StatusTone,
} from "../format";
import { languageLabel } from "../languages";

const TONES: Record<StatusTone, string> = {
  ok: "border-lime/45 bg-lime/10 text-foreground",
  waiting: "border-warning/45 bg-warning/10 text-foreground",
  bad: "border-destructive/35 bg-destructive/10 text-foreground",
  muted: "border-border bg-secondary text-muted-foreground",
};

const DOTS: Record<StatusTone, string> = {
  ok: "bg-lime",
  waiting: "bg-warning",
  bad: "bg-destructive",
  muted: "bg-muted-foreground/60",
};

const QUALITY: Record<string, { label: string; className: string }> = {
  GREEN: { label: "High quality", className: "bg-lime" },
  YELLOW: { label: "Medium quality", className: "bg-warning" },
  RED: { label: "Low quality", className: "bg-destructive" },
};

const MEDIA_HEADERS: Record<string, { label: string; icon: typeof FileText }> = {
  IMAGE: { label: "Image header", icon: ImageIcon },
  VIDEO: { label: "Video header", icon: Video },
  DOCUMENT: { label: "Document header", icon: FileText },
};

/** Splits body text on `{{tokens}}` so each one reads as a fill-in slot. */
const TOKEN = /(\{\{\s*[A-Za-z0-9_]+\s*\}\})/g;

/**
 * One template, as one card.
 *
 * The top half is the message at roughly the size it arrives: the same
 * WhatsApp chrome the builder uses, shrunk to a card. Tokens stay visible as
 * pills — a card is a catalogue entry, not a send — so the shape of the
 * personalisation is visible at a glance. The body and footer are shown whole
 * rather than clamped: the message is what a template is judged by, and a
 * four-line preview hid the part someone had written for. The bottom half is
 * the facts a card is judged by: name, review status, category, language,
 * last change.
 */
export function TemplateCard({
  row,
  href,
}: {
  row: TemplateFacts;
  /** Where the card leads. Omitted on the detail screen, which is the end. */
  href?: string;
}) {
  const parts = templateParts(row.components);
  // An image header can show the real sample; video and document headers keep
  // the icon, because a still frame of either would be a guess.
  const imageHeader = parts.headerKind === "IMAGE";
  const media =
    parts.headerKind && !imageHeader
      ? MEDIA_HEADERS[parts.headerKind]
      : undefined;
  const mediaIcon = media ? media.icon : null;

  // WhatsApp collapses more than three buttons: two stay, the rest go behind
  // "See all options" — the same rule the full preview follows.
  const collapsed = parts.buttons.length > 3;
  const shown = collapsed ? parts.buttons.slice(0, 2) : parts.buttons;

  const tone = statusTone(row.status);
  const quality = row.qualityScore ? QUALITY[row.qualityScore.toUpperCase()] : undefined;

  return (
    <li className="relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/25">
      {/* One overlay rather than a wrapper: the card is a list item, and a
          link around it would put an anchor between `li` and `ul`. */}
      {href ? (
        <Link
          aria-label={`Open ${row.name}`}
          className="absolute inset-0 z-10 rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          href={href}
        />
      ) : null}
      <div
        aria-label="Message preview"
        className="flex flex-1 flex-col justify-start gap-1.5 bg-[#efeae2] px-3 pt-4 pb-3"
        role="group"
      >
        <div className="ml-auto w-full max-w-[19rem] space-y-1.5">
          <div className="rounded-lg rounded-tr-none bg-white shadow-sm">
            <div className="px-2.5 py-2">
              {imageHeader ? (
                <TemplateImage
                  alt={`Sample image for ${row.name}`}
                  className="mb-1.5 aspect-[1.91/1] w-full rounded-md"
                  hasMedia={row.hasMedia}
                  templateId={row.id}
                />
              ) : mediaIcon ? (
                <div className="mb-1.5 grid h-16 place-items-center rounded-md bg-[#d1d7db]">
                  {React.createElement(mediaIcon, {
                    className: "size-4 text-[#5b6b73]",
                  })}
                </div>
              ) : null}

              {parts.header ? (
                <p className="text-[12.5px] leading-snug font-semibold whitespace-pre-wrap text-[#111b21]">
                  {parts.header}
                </p>
              ) : null}

              {parts.body ? (
                <p
                  className={cn(
                    "text-[12.5px] leading-[1.45] whitespace-pre-wrap text-[#111b21]",
                    (parts.header || imageHeader || mediaIcon) && "mt-1",
                  )}
                >
                  {withTokens(parts.body)}
                </p>
              ) : (
                <p className="text-[12.5px] leading-[1.45] text-[#667781]">
                  No body text stored for this template.
                </p>
              )}

              {parts.footer ? (
                <p className="mt-1.5 text-[10.5px] leading-snug whitespace-pre-wrap text-[#667781]">
                  {parts.footer}
                </p>
              ) : null}

              <p className="mt-1 flex items-center justify-end gap-1 text-[9.5px] text-[#667781]">
                <span className="tabular-nums">now</span>
                <span className="text-[#53bdeb]">✓✓</span>
              </p>
            </div>
          </div>

          {shown.map((button, index) => (
            <div
              className="flex items-center justify-center rounded-lg bg-white px-3 py-1.5 text-center text-[12px] font-medium text-[#00a5f4] shadow-sm"
              key={`${button.type}-${index}`}
            >
              {buttonLabel(button)}
            </div>
          ))}

          {collapsed ? (
            <div className="flex items-center justify-center rounded-lg bg-white px-3 py-1.5 text-center text-[12px] font-medium text-[#00a5f4] shadow-sm">
              See all options
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-foreground">
            {row.name}
          </p>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap",
              TONES[tone],
            )}
          >
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOTS[tone])} />
            {statusLabel(row.status)}
          </span>
        </div>

        {row.rejectedReason ? (
          <p className="flex items-start gap-1.5 text-[12px] leading-snug text-destructive">
            <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            {row.rejectedReason}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
          <span className="rounded-full border border-border bg-secondary px-2 py-0.5">
            {categoryLabel(row.category)}
          </span>
          <span className="rounded-full border border-border bg-secondary px-2 py-0.5">
            {languageLabel(row.language)}
          </span>
          {quality ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", quality.className)} />
              {quality.label}
            </span>
          ) : null}
          <span className="ml-auto tabular-nums">{updatedLabel(row.updatedAt)}</span>
        </div>
      </div>
    </li>
  );
}

/** Body text with each `{{token}}` drawn as a slot rather than literal braces. */
function withTokens(text: string): React.ReactNode {
  return text.split(TOKEN).map((piece, index) =>
    index % 2 === 1 ? (
      <span
        className="mx-px rounded-sm bg-[#111b21]/10 px-1 py-px font-mono text-[10.5px] text-[#3b4a54]"
        key={index}
      >
        {piece.replace(/[{}]/g, "").trim()}
      </span>
    ) : (
      <React.Fragment key={index}>{piece}</React.Fragment>
    ),
  );
}

function buttonLabel(button: TemplateButtonFact): string {
  if (button.type === "COPY_CODE") return "Copy code";

  return button.text ?? (button.type === "PHONE_NUMBER" ? "Call" : "Open link");
}
