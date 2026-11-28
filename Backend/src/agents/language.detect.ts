/**
 * What language a customer wrote in, decided from the message itself.
 *
 * Deliberately not a model call. Three scripts cover the traffic this product
 * sees, and counting characters answers the question for certain at the cost of
 * nothing — a round-trip would spend a sixth of the fifteen-second budget on a
 * decision a `for` loop already knows. The model is told the answer, not asked
 * for it.
 *
 * `te-en` is the fourth case and the reason this file exists: a Telugu customer
 * typing in English letters ("Hi em chestunnavu") must be answered in Telugu
 * letters, not in English prose.
 */
export type LanguageCode = "te" | "en" | "hi" | "te-en";

export interface DetectedLanguage {
  code: LanguageCode;
  /** 0–1. Script evidence is near-certain; a romanised guess is not. */
  confidence: number;
  /** What the prompt tells the model to write. */
  instruction: string;
}

/** The business's own language, and the answer when nothing else is. */
export const DEFAULT_LANGUAGE: LanguageCode = "te";

/** Telugu and Devanagari blocks, plus Latin letters. */
const TELUGU = /[\u0C00-\u0C7F]/gu;
const DEVANAGARI = /[\u0900-\u097F]/gu;
const LATIN = /[A-Za-z]/gu;

/**
 * Words that are Telugu with the letters folded to ASCII.
 *
 * Not an attempt at transliteration: these are the tokens that appear so often
 * in a WhatsApp message that one of them settles the question, and a false
 * positive costs a Telugu reply to an English question — which a Telugu-speaking
 * business reads as normal rather than wrong.
 */
const ROMAN_TELUGU = new Set([
  "anna",
  "akka",
  "andi",
  "avunu",
  "baga",
  "bagundi",
  "bro",
  "chala",
  "cheppandi",
  "cheppu",
  "chestunnav",
  "chestunnavu",
  "cheyandi",
  "cheyyandi",
  "ekkada",
  "ela",
  "em",
  "enduku",
  "enti",
  "eppudu",
  "garu",
  "kadu",
  "kadhu",
  "kavali",
  "ledu",
  "ledhu",
  "manchidi",
  "ra",
  "tinnava",
  "tinnavu",
  "undi",
  "unnav",
  "unnavu",
  "vaddu",
  "vundi",
]);

/**
 * Messages with no subject at all: "Hi", "Hello", "thanks".
 *
 * They are language-neutral, so counting letters would call "Hi" English and
 * answer a Telugu customer in English on their very first message. They fall to
 * the business default instead.
 */
const GREETING = new Set([
  "hello",
  "hey",
  "hi",
  "hii",
  "hlo",
  "namaste",
  "namaskaram",
  "ok",
  "okay",
  "thanks",
  "thank",
  "you",
]);

const INSTRUCTIONS: Record<LanguageCode, string> = {
  te: "Write in Telugu script (తెలుగు), the language the customer used.",
  "te-en":
    "Write in Tenglish: Telugu written with English letters, the way the customer wrote.",
  en: "Write in English.",
  hi: "Write in Hindi (हिन्दी), the language the customer used.",
};

/** The language a message is in, and how sure the count is. */
export function detectLanguage(text: string): DetectedLanguage {
  const telugu = count(TELUGU, text);
  const devanagari = count(DEVANAGARI, text);
  const latin = count(LATIN, text);
  const letters = telugu + devanagari + latin;

  // A sticker, a number, an emoji: no evidence either way.
  if (letters === 0) return detected(DEFAULT_LANGUAGE, 0);

  // An Indic script needs a real share of the message, not one borrowed word:
  // "మెనూ price enti?" is a Telugu message with English in it, while a single
  // "₹" or a transliterated name inside English prose is not.
  const indic = Math.max(telugu, devanagari);

  if (indic > 0 && indic * 4 >= latin) {
    const code: LanguageCode = telugu >= devanagari ? "te" : "hi";

    return detected(code, indic / letters);
  }

  const words = text
    .toLowerCase()
    .split(/[^a-z]+/u)
    .filter((word) => word.length > 0);

  if (words.length === 0) return detected(DEFAULT_LANGUAGE, 0);

  // Every word a greeting: neutral, so the business default answers it.
  if (words.every((word) => GREETING.has(word))) {
    return detected(DEFAULT_LANGUAGE, 0.4);
  }

  return words.some((word) => ROMAN_TELUGU.has(word))
    ? detected("te-en", 0.6)
    : detected("en", 0.8);
}

function detected(code: LanguageCode, confidence: number): DetectedLanguage {
  return {
    code,
    confidence: Math.round(confidence * 100) / 100,
    instruction: INSTRUCTIONS[code],
  };
}

function count(pattern: RegExp, text: string): number {
  return text.match(pattern)?.length ?? 0;
}