import type { LanguageCode } from "./language.detect";

/** What a customer sees when no answer exists, or a human was asked for. */
export const HANDOFF_MESSAGE =
  "I'm not able to answer that one from what I have, so I've asked a member of the team to pick it up. They'll reply here shortly.";

/**
 * The one word a model may say instead of an answer.
 *
 * A sentence asking the model to decline in prose would have to be recognised
 * afterwards, and recognising a refusal is guesswork. A token nobody would
 * write otherwise is not: its presence is the decision, and the customer never
 * sees it.
 */
export const HANDOFF_SENTINEL = "[handoff]";

/**
 * The same handoff, in the language the customer wrote in.
 *
 * A customer who wrote in Telugu and then received English has been told, in
 * the clearest possible way, that nobody here speaks their language. The line
 * is static rather than generated: it is the one message that must arrive even
 * when the model is the thing that failed.
 */
const HANDOFF_LINES: Record<LanguageCode, string> = {
  te: "ఈ ప్రశ్నకు నా దగ్గర ఉన్న సమాచారంతో సమాధానం చెప్పలేకపోతున్నాను. మా టీమ్ సభ్యుడికి తెలియజేశాను, వారు కొద్దిసేపట్లో ఇక్కడే రిప్లై ఇస్తారు.",
  "te-en":
    "Naa daggara unna information tho ee question ki answer cheppalekapothunnanu. Team ki cheppanu, vaallu konchem sepatlo ikkade reply istharu.",
  en: HANDOFF_MESSAGE,
  hi: "मेरे पास मौजूद जानकारी से इस सवाल का जवाब नहीं दे पा रहा हूँ। मैंने हमारी टीम को बता दिया है, वे थोड़ी देर में यहीं जवाब देंगे।",
};

/** The handoff line for a language, English when none was detected. */
export function handoffLine(language?: LanguageCode): string {
  return language ? HANDOFF_LINES[language] : HANDOFF_MESSAGE;
}

/**
 * The answer as WhatsApp renders it, not as it was written.
 *
 * A support answer that invents `aotms-support.com` sends a customer to a
 * squatter, so any URL the source material does not contain is removed. The
 * rest is formatting: WhatsApp reads `*bold*`, not Markdown.
 */
export function cleanReply(
  text: string,
  input: { maxChars: number; context: string },
): string {
  let out = text.replace(/\r\n?/g, "\n").trim();

  out = out.replace(/^```[a-z]*\s*$/gim, "");
  out = out.replace(/^#{1,6}\s+/gm, "");
  out = out.replace(/\*\*(.+?)\*\*/g, "*$1*");
  out = out.replace(/__(.+?)__/g, "_$1_");
  out = out
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = stripUnknownLinks(out, input.context).trim();

  if (out.length > input.maxChars) out = truncateAtSentence(out, input.maxChars);

  return out;
}

/**
 * A link that might have been invented: with a scheme, with `www.`, an email
 * address, or a bare domain on a known suffix. A scheme covers any top-level
 * domain, which a whitelist cannot.
 */
const LINK =
  /\b(?:https?:\/\/|www\.)[^\s<>]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|co|in|uk|lk|ae|de|fr|es|it|info|biz|shop|store|app|dev|me)\b[^\s<>]*/gi;

/** Punctuation a sentence leaves behind a link. */
const TRAIL = /[.,;:!?'"”’)\]]+$/;

/** A link reduced to the destination a customer would land on. */
function destinationOf(token: string): string {
  return token
    .toLowerCase()
    .replace(/^mailto:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(TRAIL, "");
}

function stripUnknownLinks(text: string, context: string): string {
  // Exact destinations, not substrings: `not-evil.com` in the material must
  // not authorise `evil.com`, and a path the material never names is invented
  // even when the host is real.
  const allowed = new Set<string>();

  for (const match of context.matchAll(LINK)) {
    const destination = destinationOf(match[0]);
    if (destination.length === 0) continue;

    allowed.add(destination);

    // A link to the bare host of a named page is that page's own site.
    const slash = destination.indexOf("/");
    if (slash > 0) allowed.add(destination.slice(0, slash));
  }

  return text
    .replace(LINK, (match) => {
      // A sentence that ends in a real link would otherwise be compared with
      // its full stop attached, fail, and lose the link.
      const trail = TRAIL.exec(match)?.[0] ?? "";
      const destination = destinationOf(match.slice(0, match.length - trail.length));

      return destination.length > 0 && allowed.has(destination) ? match : "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\(\s*\)/g, "")
    // A removed link leaves its full stop behind a space: "Email ." → "Email.".
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/** Cut on a sentence, then a line, then a space — never mid-word. */
function truncateAtSentence(text: string, maxChars: number): string {
  const head = text.slice(0, maxChars);
  const window = head.slice(Math.max(0, head.length - 200));

  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  );

  if (sentence >= 0) {
    const at = head.length - window.length + sentence + 1;
    return head.slice(0, at).trim();
  }

  const line = head.lastIndexOf("\n");
  if (line > 0) return head.slice(0, line).trim();

  const space = head.lastIndexOf(" ");
  // No boundary anywhere before the limit means the whole reply is one
  // unbroken token; a fragment of it is not an answer.
  return space > 0 ? head.slice(0, space).trim() : "";
}

/** A keyword the operator said a human must see, matched whole-word. */
export function matchesEscalation(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();

  return keywords.some((keyword) => {
    const needle = keyword.trim().toLowerCase();
    if (needle.length === 0) return false;

    // Bounded by "not a letter or digit" on both sides, so `human` does not
    // fire inside `humanitarian`, and a later occurrence is still seen —
    // checking only the first one let an embedded word hide a real request.
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`,
      "u",
    );

    return pattern.test(lower);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
