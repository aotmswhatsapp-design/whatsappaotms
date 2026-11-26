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

/** One sentence for the owner, naming the shape and why. */
export function shapeNote(card: BotCard): string {
  const buttons = shownButtons(card).length;

  switch (shapeOfCard(card)) {
    case "text":
      return "Arrives as plain text: a card with no buttons has nothing to tap.";
    case "buttons":
      return `Arrives with ${buttons} reply ${buttons === 1 ? "button" : "buttons"}.`;
    case "list":
      return `Arrives as a list: WhatsApp allows ${MAX_BUTTONS} buttons, so ${buttons} choices become one "See options" list.`;
    case "numbered":
      return `Arrives as numbered text: a list holds ${MAX_LIST_ROWS} rows, and the customer answers with a number.`;
  }
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
  const nothing = !title && !info && buttons.length === 0 && !card.imageUrl;

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-3xl border border-border shadow-sm",
        className,
      )}
    >
      {/* Hard-coded app colours on purpose: the inbox repaints `--brand` and
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
        ) : shape === "numbered" ? (
          // The fallback is a plain text message, so it is drawn as one: the
          // numbers are the routing key, not decoration.
          <div className="ml-auto max-w-[92%] min-w-0 rounded-lg rounded-tr-none bg-white px-2.5 py-2 shadow-sm">
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
          <div className="ml-auto max-w-[92%] min-w-0 rounded-lg rounded-tr-none bg-white px-2.5 py-2 shadow-sm">
            {card.imageUrl && shape !== "text" ? (
              // Meta fetches this URL from its own servers, so it is not a
              // local path and `next/image` would need a remote pattern for an
              // origin we do not control.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                className="mb-1 aspect-[1.91/1] w-full rounded-md object-cover"
                src={card.imageUrl}
              />
            ) : null}

            {title ? (
              <p className="text-[13.5px] leading-snug font-semibold break-words whitespace-pre-wrap text-[#111b21]">
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

            <Timestamp />
          </div>
        )}

        {/* Three reply buttons arrive as their own rows; the rest move behind a
            single opener. */}
        {shape === "buttons"
          ? buttons.map((button) => (
              <div
                className="flex items-center justify-center rounded-lg bg-white px-3 py-2 text-center text-[13px] font-medium break-words text-[#00a5f4] shadow-sm"
                key={button.id}
              >
                {button.label}
              </div>
            ))
          : null}

        {shape === "list" ? (
          <div className="flex items-center justify-center rounded-lg bg-white px-3 py-2 text-center text-[13px] font-medium text-[#00a5f4] shadow-sm">
            See options
          </div>
        ) : null}
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
