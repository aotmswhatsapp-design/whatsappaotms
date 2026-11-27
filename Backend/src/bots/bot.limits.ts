/**
 * Meta's own numbers for an interactive message.
 *
 * These are not preferences. A payload one character over is rejected with a
 * 131009 and the customer receives nothing, so the renderer uses them to choose
 * which shape to send rather than to hope.
 */

/** Reply buttons: three is the maximum in one message, and the title is the only visible part. */
export const MAX_BUTTONS = 3;
export const BUTTON_TITLE = 20;

/** A list message: ten rows across all sections, and each row has two lines. */
export const MAX_LIST_ROWS = 10;
export const LIST_ROW_TITLE = 24;
export const LIST_ROW_DESCRIPTION = 72;

/** The label on the list's opener, which is not one of the rows. */
export const LIST_BUTTON_LABEL = 20;

/** The sentence above the buttons, and the header text when there is no image. */
export const BODY_CHARS = 1024;
export const HEADER_CHARS = 60;

/**
 * How many pictures one card may show.
 *
 * Not Meta's number, because Meta has none: every picture past the first is a
 * message of its own, and a card that arrives as a dozen bubbles is a report,
 * not a menu. Ten is what a customer will scroll through and still tap.
 */
export const MAX_CARD_IMAGES = 10;

/** A plain text message, which is what every fallback lands on. */
export const TEXT_CHARS = 4096;
