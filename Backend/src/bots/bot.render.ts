import {
  shownButtons,
  type BotButton,
  type BotCard,
  type CardFile,
} from "./bot.card";
import {
  BODY_CHARS,
  BUTTON_TITLE,
  HEADER_CHARS,
  LIST_BUTTON_LABEL,
  LIST_ROW_TITLE,
  MAX_BUTTONS,
  MAX_LIST_ROWS,
  TEXT_CHARS,
} from "./bot.limits";

/**
 * A card becomes whatever WhatsApp will actually accept.
 *
 * The ladder is fixed by Meta, not by us: three reply buttons per message, then
 * a list of ten rows, and past that nothing structured is possible. The last
 * step is therefore not an error path — a card with twelve choices has to reach
 * the customer somehow, and numbered text does, because the numbers are the same
 * order the buttons were defined in and the router turns them back into ids.
 */

/** Meta's interactive payload, as the Graph call sends it. */
export interface InteractiveMessage {
  type: "button" | "list";
  header?:
    | { type: "image"; image: { link: string } }
    | { type: "text"; text: string };
  body: { text: string };
  action:
    | { buttons: { type: "reply"; reply: { id: string; title: string } }[] }
    | { button: string; sections: { rows: { id: string; title: string }[] }[] };
}

export type Rendered =
  /** `interactive` is the wire shape; `body` is what the thread and the queue show. */
  | { kind: "buttons" | "list"; interactive: InteractiveMessage; body: string }
  /** Everything a text message can carry, buttons numbered inside it. */
  | { kind: "text"; body: string };

/**
 * A card as it actually leaves the number.
 *
 * WhatsApp has no album: an interactive header holds one picture, and every
 * other picture has to be a message of its own. This is the one place that
 * decision is made, so the sender only iterates and the builder can say the
 * same thing without duplicating the rule.
 */
export interface CardDelivery {
  /**
   * Documents and videos to send as their own messages, before anything else.
   *
   * First because they are the thing being handed over: a customer who asked
   * for the price list should not have to scroll past the menu to reach it.
   * Never a header — a card's header is a picture or a line of text.
   */
  files: CardFile[];
  /** Pictures to send as their own image messages, in the order given. */
  photos: string[];
  /** The card message itself, sent after them. */
  message: Rendered;
}

export function deliverCard(card: BotCard): CardDelivery {
  const files = card.files.filter((file) => file.url.trim().length > 0);
  const photos = card.imageUrls.filter((url) => url.trim().length > 0);
  const rendered = renderCard(card);

  // One picture and something to tap: the picture is the bubble's header,
  // exactly as a card has always looked. Files never take the header, so they
  // change nothing about which shape is sent.
  if (photos.length === 0 || (photos.length === 1 && rendered.kind !== "text")) {
    return { files, photos: [], message: rendered };
  }

  // Everything else: the pictures arrive first, one message each, and the card
  // follows with a text header so no picture is shown twice. A card with no
  // buttons is in this branch too — its picture used to be dropped entirely,
  // which is indefensible once a card can carry several.
  return { files, photos, message: renderCard(card, "title") };
}

/** Copy, not business information: this is the label on the list's opener. */
export const LIST_OPEN_LABEL = "See options";

/** Copy, not business information: the line that tells a customer how to answer. */
export const NUMBERED_HINT = "Reply with a number.";

export function renderCard(
  card: BotCard,
  /** `title` forces the text header, for a card whose pictures travel alone. */
  header: "photo" | "title" = "photo",
): Rendered {
  const buttons = shownButtons(card);
  const info = clip(card.info.trim(), TEXT_CHARS);

  if (buttons.length === 0) {
    // The information alone. No header image: an image with nothing to tap is a
    // poster, and the customer has no way to say which part they meant.
    return { kind: "text", body: info.length > 0 ? info : card.title.trim() };
  }

  const heading = headerOf(card, header);

  if (buttons.length <= MAX_BUTTONS) {
    return {
      kind: "buttons",
      body: info,
      interactive: {
        type: "button",
        ...(heading ? { header: heading } : {}),
        body: { text: bodyText(info, card) },
        action: {
          buttons: buttons.map((button) => ({
            type: "reply",
            // The id is ours and is what a tap returns; the title is truncated
            // to Meta's 20 characters and is only ever read by a human.
            reply: { id: button.id, title: fit(button.label, BUTTON_TITLE) },
          })),
        },
      },
    };
  }

  if (buttons.length <= MAX_LIST_ROWS) {
    return {
      kind: "list",
      body: info,
      interactive: {
        type: "list",
        ...(heading ? { header: heading } : {}),
        body: { text: bodyText(info, card) },
        action: {
          button: fit(LIST_OPEN_LABEL, LIST_BUTTON_LABEL),
          sections: [
            {
              rows: buttons.map((button) => ({
                id: button.id,
                title: fit(button.label, LIST_ROW_TITLE),
              })),
            },
          ],
        },
      },
    };
  }

  return { kind: "text", body: numbered(info, buttons) };
}

/** The message body, which cannot be empty: Meta rejects a blank one. */
function bodyText(info: string, card: BotCard): string {
  const text = clip(info, BODY_CHARS);
  if (text.length > 0) return text;

  // A card whose information is blank still needs a body Meta will accept.
  return fit(card.title, BODY_CHARS) || card.title.slice(0, BODY_CHARS);
}

function headerOf(
  card: BotCard,
  mode: "photo" | "title",
): InteractiveMessage["header"] | null {
  // `title` is used when the pictures travel as their own messages: putting
  // one of them here would show the same picture twice.
  const picture = mode === "photo" ? card.imageUrls[0] : undefined;

  if (picture) return { type: "image", image: { link: picture } };

  // Otherwise the card's name becomes a text header, which is where a menu
  // heading belongs. Omitted entirely when there is nothing to say.
  const title = fit(card.title, HEADER_CHARS);

  return title.length > 0 ? { type: "text", text: title } : null;
}

/**
 * The fallback. Same order as the buttons, so "2" is the second one — the
 * numbering is not decoration, it is the routing key when the structure could
 * not be sent.
 */
export function numbered(info: string, buttons: BotButton[]): string {
  const picks = buttons.map((button, at) => `${at + 1}) ${fit(button.label, 80)}`);
  const parts = [info, picks.join("\n"), NUMBERED_HINT].filter(
    (part) => part.trim().length > 0,
  );

  return clip(parts.join("\n\n"), TEXT_CHARS);
}

/**
 * One line, at most `max` characters, cut at a word boundary.
 *
 * Titles are single-line by Meta's rules, so runs of whitespace become one
 * space. A cut that leaves a trailing comma or dash reads like a typo, so those
 * go too.
 */
export function fit(text: string, max: number): string {
  const clean = text.replace(/\s+/gu, " ").trim();

  if (clean.length <= max) return clean;

  return cutAt(clean, max).replace(/[\s,;:.·\-–—]+$/u, "");
}

/**
 * The same cut, but newlines survive: the information on a card is allowed to be
 * paragraphs, and reflowing it into one line would destroy a price list.
 */
export function clip(text: string, max: number): string {
  const clean = text.trim();

  return clean.length <= max ? clean : cutAt(clean, max);
}

function cutAt(text: string, max: number): string {
  const window = text.slice(0, max + 1);
  const space = window.lastIndexOf(" ");

  // No space to cut on — a single long word or URL — so the cut is hard.
  return (space > 0 ? window.slice(0, space) : text.slice(0, max)).trim();
}
