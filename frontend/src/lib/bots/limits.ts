/**
 * Meta's numbers for an interactive message, mirrored for the builder.
 *
 * The authority is `Backend/src/bots/bot.limits.ts`; these copies exist only so
 * a field can say "20 characters" while the owner types. Nothing is refused
 * here — the server clips or refuses on its own terms — but a counter that
 * disagreed with the server would be worse than none, so a change there is a
 * change here.
 */

/** Reply buttons in one message. More become a list, and past ten, numbered text. */
export const MAX_BUTTONS = 3;

/** One button title, on one line. */
export const BUTTON_TITLE = 20;

/** Rows across a list message. */
export const MAX_LIST_ROWS = 10;

/** The sentence above the buttons. */
export const BODY_CHARS = 1024;

/** The header line when a card has no picture. */
export const HEADER_CHARS = 60;

/** A plain text message, which is where every fallback lands. */
export const TEXT_CHARS = 4096;
