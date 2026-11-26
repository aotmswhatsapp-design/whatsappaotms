/**
 * The words a question is made of, in the shape the local search matches on.
 *
 * Everything here is deterministic and local. That is the point of the engine:
 * no vendor decides what a customer meant, and the same question always
 * produces the same search. The fold is deliberately shallow — a plural, a
 * participle, a trailing `e` — because a full stemmer is a dictionary, and a
 * dictionary that guesses wrong costs precision on every question rather than
 * recall on a few.
 *
 * The same function runs over the question and over the material, so a fold
 * only has to be *consistent*, not linguistically correct: `price` and
 * `pricing` both become `pric`, which is all the sentence scorer needs.
 */

/**
 * Words that carry no subject.
 *
 * Greetings are in here on purpose. A `hello` has nothing to retrieve, and
 * searching for chunks that happen to contain the word answers it wrongly;
 * the conversation engine answers a greeting from its own menu instead.
 */
const STOPWORDS = new Set(
  (
    "a an the and or but if of to in on at for with by from as into over under " +
    "is are was were be been being am do does did done have has had having " +
    "can could will would shall should may might must " +
    "i me my mine we us our ours you your yours he him his she her hers it its " +
    "they them their theirs this that these those there here " +
    "what which who whom whose when where why how " +
    "any some more most much many very just also only same own other each both all such than then so too " +
    "about above below after before again against between during through " +
    "please thanks thank hi hello hey dear sir madam ok okay yes no not"
  ).split(" "),
);

export interface Normalized {
  /** The question as one search string: lowercase, unaccented, punctuation
   *  removed. Handed to `word_similarity`, which reads it as a phrase. */
  text: string;
  /** Distinct meaningful words, folded, in the order they were written. */
  terms: string[];
  /** `terms` as the OR expression `websearch_to_tsquery` understands, so one
   *  matching word is enough to reach the ranker. Empty when the question had
   *  no meaningful words at all. */
  anyOf: string;
}

export function normalize(question: string): Normalized {
  const text = squash(question);
  // Deduplicated: "price of price list" is one term, and a repeated word must
  // not make a chunk look twice as relevant.
  const terms = [...new Set(tokensOf(text))];

  return { text, terms, anyOf: terms.join(" OR ") };
}

/** Every meaningful, folded word in a piece of text. Duplicates are kept, so
 *  a caller counting overlap counts each word once per position. */
export function tokensOf(input: string): string[] {
  const out: string[] = [];

  for (const word of squash(input).split(" ")) {
    // One letter is never a subject a business document answers.
    if (word.length < 2 || STOPWORDS.has(word)) continue;
    out.push(fold(word));
  }

  return out;
}

/** Lowercase, unaccented, punctuation-free, single-spaced. */
function squash(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The shallow fold. Every branch is bounded by length, because an unbounded
 * suffix rule is how `thing` becomes `th` and a `seed` stops matching `seeds`.
 */
export function fold(word: string): string {
  if (word.length <= 3) return word;

  if (word.length > 4 && word.endsWith("ies")) {
    word = `${word.slice(0, -3)}y`;
  } else if (
    // `business`, `status`, `analysis` end in a letter that only looks plural.
    !word.endsWith("ss") &&
    !word.endsWith("us") &&
    !word.endsWith("is") &&
    word.length > 4 &&
    word.endsWith("es")
  ) {
    word = word.slice(0, -2);
  } else if (
    !word.endsWith("ss") &&
    !word.endsWith("us") &&
    !word.endsWith("is") &&
    word.endsWith("s")
  ) {
    word = word.slice(0, -1);
  }

  if (word.length > 5 && word.endsWith("ing")) word = word.slice(0, -3);
  else if (word.length > 5 && word.endsWith("ed")) word = word.slice(0, -2);

  // `price` and `pricing` differ only by this `e` once the suffix is gone.
  if (word.length > 4 && word.endsWith("e")) word = word.slice(0, -1);

  return word;
}
