import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A template as WhatsApp draws it: the app bar, the chat wallpaper, the
 * outbound bubble and its buttons.
 *
 * One component for both screens — the builder's live preview and the inbox's
 * send panel — so the two cannot drift into two different bubbles. Every string
 * arrives already filled, because the two callers resolve variables from
 * different maps: examples in the builder, the agent's values in the inbox.
 *
 * Nothing here caps its own height. A body of ten lines and four buttons is
 * meant to be read in full; the surface that owns the height (the composer, the
 * builder's column) scrolls.
 */
export function TemplateBubble({
  header,
  media,
  body,
  footer,
  buttons,
  empty = "Your message appears here as you type.",
  className,
}: {
  /** The header line, already filled. Null when the header is an image. */
  header: string | null;
  /** The header picture, drawn above the text. Null when there is none. */
  media?: React.ReactNode;
  body: string;
  footer: string | null;
  /** Button labels, in order and already resolved. */
  buttons: string[];
  /** What the bubble says before anything is typed. */
  empty?: string;
  className?: string;
}) {
  // WhatsApp collapses more than three buttons: two stay visible and the rest
  // move behind "See all options".
  const collapsed = buttons.length > 3;
  const shown = collapsed ? buttons.slice(0, 2) : buttons;
  const nothing =
    !header && !media && !body.trim() && !footer && buttons.length === 0;

  return (
    <div
      className={cn(
        // `w-full` is the point: a narrow preview hides the wrapping, the
        // button stack and the footer — the three things an agent checks
        // before sending.
        "w-full overflow-hidden rounded-3xl border border-border shadow-sm",
        className,
      )}
    >
      {/* WhatsApp's own chrome. It is drawn with hard-coded app colours rather
          than role tokens on purpose: the inbox card repaints `--brand` and
          friends, and this bar has to look the same on both screens. */}
      <div className="flex items-center gap-2 bg-[#008069] px-3 py-2.5 text-white">
        <span aria-hidden="true" className="text-lg leading-none">
          ‹
        </span>
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-white/25 text-[11px] font-semibold"
        >
          B
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">Your business</p>
          <p className="text-[10.5px] text-white/75">online</p>
        </div>
        <span aria-hidden="true" className="text-base leading-none">
          ⋮
        </span>
      </div>

      <div className="space-y-2 bg-[#efeae2] px-3 py-5">
        <p className="mx-auto w-fit rounded-md bg-white/85 px-2 py-1 text-[10.5px] text-[#667781] shadow-sm">
          Today
        </p>

        {nothing ? (
          <p className="rounded-lg bg-white px-3 py-2.5 text-[13px] leading-relaxed text-[#667781] shadow-sm">
            {empty}
          </p>
        ) : (
          // Hugs the sender's edge with a squarer top-right corner, the way an
          // outbound bubble sits in the app. `break-words` is what keeps a long
          // URL or an unfilled `{{token}}` inside the bubble instead of
          // stretching it past the wallpaper.
          <div className="ml-auto max-w-[92%] min-w-0 overflow-hidden rounded-lg rounded-tr-none bg-white px-2.5 py-2 shadow-sm">
            {media}

            {header ? (
              <p className="text-[13.5px] leading-snug font-semibold break-words whitespace-pre-wrap text-[#111b21]">
                {header}
              </p>
            ) : null}

            {body.trim() ? (
              <p
                className={cn(
                  "text-[13.5px] leading-[1.45] break-words whitespace-pre-wrap text-[#111b21]",
                  header || media ? "mt-1" : null,
                )}
              >
                {body}
              </p>
            ) : null}

            {footer ? (
              <p className="mt-1.5 text-[11.5px] leading-snug break-words whitespace-pre-wrap text-[#667781]">
                {footer}
              </p>
            ) : null}

            <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-[#667781]">
              <span className="tabular-nums">now</span>
              <span aria-hidden="true" className="text-[#53bdeb]">
                ✓✓
              </span>
            </p>

            {/* The choices belong to the message, so they are drawn inside its
                bubble — the same shape the chatbot card uses, with the
                negative margins cancelling the bubble's padding so the
                divider reaches its edges. */}
            {shown.length > 0 ? (
              <div className="-mx-2.5 -mb-2 mt-1 flex flex-wrap gap-1.5 border-t border-black/10 p-2">
                {shown.map((label, index) => (
                  <div
                    className="min-w-0 grow basis-[calc(50%-0.375rem)] rounded-full border border-[#111b21]/45 px-2.5 py-1.5 text-center text-[12px] leading-tight font-normal break-words text-[#111b21]"
                    key={`${label}-${index}`}
                  >
                    {label}
                  </div>
                ))}

                {collapsed ? (
                  <div className="w-full rounded-full border border-[#111b21]/45 px-2.5 py-1.5 text-center text-[12px] leading-tight font-medium text-[#111b21]">
                    See all options
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
