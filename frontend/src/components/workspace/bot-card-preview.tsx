import { ChevronLeft, MoreVertical } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  shownButtons,
  type BotCard,
} from "@/lib/bots/card";
import { MAX_BUTTONS, MAX_LIST_ROWS } from "@/lib/bots/limits";

/** Which of Meta's four shapes one card becomes. */
export type CardShape = "text" | "buttons" | "list" | "numbered";

/**
 * The ladder, mirrored from `Backend/src/bots/bot.render.ts` so the builder can
 * say what will actually arrive.
 *
 * It is a ladder, not a validation: three buttons, then ten list rows, then
 * numbered plain text. A card with twelve choices is still sendable — the
 * numbers are the same order the buttons were defined in.
 */
export function shapeOfCard(card: BotCard): CardShape {
  const buttons = shownButtons(card).length;

  if (buttons === 0) return "text";
  if (buttons <= MAX_BUTTONS) return "buttons";
  if (buttons <= MAX_LIST_ROWS) return "list";

  return "numbered";
}

/**
 * True when this card is sent as a WhatsApp interactive message — the shape
 * that carries a picture header and tappable choices. A card with no buttons,
 * or with more rows than a list holds, arrives as plain text instead, and the
 * thread already shows that text.
 */
export function isInteractive(card: BotCard): boolean {
  const shape = shapeOfCard(card);

  return shape === "buttons" || shape === "list";
}

/**
 * One sentence for the owner, naming the shape and why — followed, when it
 * applies, by what happens to the card's heading. Two sentences at most: a
 * shape that drops the heading is exactly the case this line exists to make
 * honest.
 */
export function shapeNote(card: BotCard): string {
  return `${shapeSentence(card)} ${headingNote(card)}`.trim();
}

function shapeSentence(card: BotCard): string {
  const buttons = shownButtons(card).length;

  switch (shapeOfCard(card)) {
    case "text": {
      const pictures = picturesOf(card);

      return pictures > 0
        ? `The card arrives as plain text because it has no buttons; ${pictures === 1 ? "its picture is" : `its ${pictures} pictures are`} sent first, each as its own message.`
        : "Arrives as plain text: a card with no buttons has nothing to tap.";
    }
    case "buttons":
      return `Arrives with ${buttons} reply ${buttons === 1 ? "button" : "buttons"}.`;
    case "list":
      return `Arrives as a list: WhatsApp allows ${MAX_BUTTONS} buttons, so ${buttons} choices become one "See options" list.`;
    case "numbered":
      return `Arrives as numbered text: a list holds ${MAX_LIST_ROWS} rows, and the customer answers with a number.`;
  }
}

/** The pictures the customer actually receives; a blank slot is not a picture. */
function picturesOf(card: BotCard): number {
  return card.imageUrls.filter((url) => url.trim().length > 0).length;
}

/**
 * What becomes of the card's heading, in one sentence — empty when there is
 * nothing worth saying.
 *
 * Mirrors `deliverCard`/`headerOf` in `Backend/src/bots/bot.render.ts` rather
 * than describing the bubble above. The heading is the text header only when
 * the card goes out interactive and no single picture has taken the header: a
 * picture header drops it, and the numbered fallback is plain text that never
 * carries it. The preview draws the heading in both of those cases anyway,
 * which is the whole reason this line exists.
 */
function headingNote(card: BotCard): string {
  const heading = card.title.trim();

  if (!heading) return "";

  // The heading is what the customer reads, so the bubble already agrees.
  if (isInteractive(card) && picturesOf(card) !== 1) return "";

  // Meta rejects a blank body, so `bodyText` falls back to the heading: the one
  // shape that drops the header and still shows the customer the heading.
  if (card.info.trim().length === 0) {
    return `The information is blank, so the heading "${heading}" is what the customer reads.`;
  }

  if (shapeOfCard(card) === "numbered") {
    return `The heading "${heading}" is not sent: the numbered text carries only the information.`;
  }

  if (isInteractive(card)) {
    return `The heading "${heading}" is not sent: the picture is this bubble's header, so WhatsApp shows no heading above the information.`;
  }

  return `The heading "${heading}" is not sent: the plain text carries only the information.`;
}

/**
 * A card as WhatsApp draws it: the app bar, the wallpaper, the outbound bubble
 * and the buttons under it.
 *
 * The same component serves the builder and the Inbox send panel, so the two
 * cannot drift into two different bubbles — the reason `TemplateBubble` is
 * shared as well. Nothing is clipped here; the surface that owns the height
 * scrolls.
 */
export function BotCardPreview({
  card,
  empty = "Your card appears here as you type.",
  className,
}: {
  card: BotCard;
  /** What the bubble says before anything is typed. */
  empty?: string;
  className?: string;
}) {
  const shape = shapeOfCard(card);
  const buttons = shownButtons(card);
  const title = card.title.trim();
  const info = card.info.trim();
  const nothing =
    !title && !info && buttons.length === 0 && card.imageUrls.length === 0;

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-3xl border border-border shadow-sm",
        className,
      )}
    >
      {/* Hard-coded app colours on purpose: the inbox repaints `--brand` and
          friends, and this bar has to look the same on both screens. */}
      <div className="flex items-center gap-2 border-b border-black/20 bg-[#008069] px-2.5 py-2.5 text-white">
        <ChevronLeft aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
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
        <MoreVertical aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
      </div>

      <div className="space-y-2 bg-[#efeae2] px-3 py-5">
        <p className="mx-auto w-fit rounded-md bg-white/85 px-2 py-1 text-[10.5px] text-[#667781] shadow-sm">
          Today
        </p>

        {nothing ? (
          <p className="rounded-lg bg-white px-3 py-2.5 text-[13px] leading-relaxed text-[#667781] shadow-sm">
            {empty}
          </p>
        ) : shape === "numbered" ? (
          // The fallback is a plain text message, so it is drawn as one: the
          // numbers are the routing key, not decoration.
          <div className="ml-auto w-[260px] max-w-full min-w-0 rounded-lg rounded-tr-none bg-white px-2.5 py-2 shadow-sm">
            <p className="text-[13.5px] leading-[1.45] break-words whitespace-pre-wrap text-[#111b21]">
              {[
                info,
                buttons.map((button, at) => `${at + 1}) ${button.label}`).join("\n"),
                "Reply with a number.",
              ]
                .filter((part) => part.trim().length > 0)
                .join("\n\n")}
            </p>
            <Timestamp />
          </div>
        ) : (
          // One message, one card: the picture is the header *inside* the
          // bubble, and the choices sit at its foot as outlined pills. WhatsApp
          // draws an interactive message this way; separate floating pills
          // would describe a different kind of message than the one we send.
          //
          // The picture is drawn even when the card has no buttons, so picking
          // one always shows what was picked; `shapeNote` says plainly that
          // such a card still arrives as plain text, with the pictures sent
          // ahead of it.
          <BotCardBody
            card={card}
            className="ml-auto w-[260px] max-w-full rounded-tr-none"
            footer={<Timestamp />}
          />
        )}
      </div>
    </div>
  );
}

function Timestamp() {
  return (
    <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-[#667781]">
      <span className="tabular-nums">now</span>
      <span aria-hidden="true" className="text-[#53bdeb]">
        ✓✓
      </span>
    </p>
  );
}

/**
 * The card itself — picture, header, information and choices — without the
 * phone frame around it.
 *
 * `BotCardPreview` wraps it in the app bar for the builder and the send panel;
 * the inbox thread puts the same markup inside a real conversation bubble, so
 * a card sent once reads identically in all three places. `footer` is the
 * preview's own timestamp line; the thread's bubble carries its time and ticks
 * outside the card.
 */
export function BotCardBody({
  card,
  footer,
  className,
}: {
  card: BotCard;
  footer?: ReactNode;
  className?: string;
}) {
  const shape = shapeOfCard(card);
  const buttons = shownButtons(card);
  const title = card.title.trim();
  const info = card.info.trim();

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-lg bg-white shadow-sm",
        className,
      )}
    >
      {card.imageUrls.length > 0 ? (
        <div className="relative">
          {/* Meta fetches this URL from its own servers, so it is not a local
              path and `next/image` would need a remote pattern for an origin
              we do not control. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="block aspect-[1.91/1] w-full object-cover"
            src={card.imageUrls[0]}
          />
          {card.imageUrls.length > 1 ? (
            // The rest are not drawn: WhatsApp has no album, so they arrive as
            // their own image messages. The count is what says so on screen.
            <span className="absolute right-1.5 bottom-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
              +{card.imageUrls.length - 1}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="px-2.5 pt-2 pb-1.5">
        {title ? (
          <p className="text-[13.5px] leading-snug font-normal break-words whitespace-pre-wrap text-[#111b21]">
            {title}
          </p>
        ) : null}

        {/* Meta rejects a blank body, so a card with no information is sent
            with its title as the body — which is what this shows. */}
        <p
          className={cn(
            "text-[13.5px] leading-[1.45] break-words whitespace-pre-wrap text-[#111b21]",
            title ? "mt-1" : null,
          )}
        >
          {info || title || "Menu"}
        </p>

        {footer}
      </div>

      {shape === "buttons" ? (
        <div className="flex flex-wrap gap-1.5 border-t border-black/10 p-2">
          {buttons.map((button) => (
            <div
              className="min-w-0 grow basis-[calc(50%-0.375rem)] rounded-full border border-[#111b21]/45 px-2.5 py-1.5 text-center text-[12px] leading-tight font-normal break-words text-[#111b21]"
              key={button.id}
            >
              {button.label}
            </div>
          ))}
        </div>
      ) : null}

      {shape === "list" ? (
        <div className="border-t border-black/10 p-2">
          <div className="rounded-full border border-[#111b21]/45 px-2.5 py-1.5 text-center text-[12px] leading-tight font-normal text-[#111b21]">
            See options
          </div>
        </div>
      ) : null}
    </div>
  );
}
