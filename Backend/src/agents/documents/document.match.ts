/**
 * Whether a message is asking for a file, and which of the agent's files it
 * means.
 *
 * Pure on purpose: no database, no storage, no model. The decision a customer
 * feels most sharply is this one — a brochure sent when they asked a question
 * is a worse reply than no brochure at all — so it is a function that can be
 * read, argued with and tested without a faked anything.
 *
 * The gate is two questions, in this order. "Did they ask to be handed
 * something?" is a small closed list of verbs in the four languages this
 * product answers in, and a message that fails it never reaches the database.
 * "Of the files this agent owns, which name shares the most words with the
 * request?" is the ranking, and a request that shares none is a miss rather
 * than a guess.
 */

/** One file the agent owns, as matching needs to see it. */
export interface FileCandidate {
  id: string;
  /** The original filename, which is what `KnowledgeSource.title` holds. */
  title: string;
  /** The tie-break: two files that fit a request equally well, newest wins. */
  updatedAt: Date;
}

/**
 * Words that mean "put the file in my hand".
 *
 * `need` and `want` are here because "I need the brochure" is how most people
 * ask, and they are safe only because a file is still required to share a word
 * with the request: "I need help with my order" names nothing and falls
 * through to an answer.
 */
const ASK = new Set([
  "send",
  "sends",
  "sending",
  "share",
  "shares",
  "sharing",
  "forward",
  "forwarded",
  "whatsapp",
  "need",
  "needs",
  "want",
  "wants",
  "give",
  "provide",
  "request",
  "email",
  "mail",
]);

/** Ways of asking that are a phrase rather than a single word. */
const ASK_PHRASES = [
  "looking for",
  "do you have",
  "can i get",
  "can you send",
  "would like",
];

/**
 * The same request in the languages a customer actually writes in.
 *
 * Telugu and Hindi are stems, not whole words: `పంప` covers పంపండి, పంపించండి
 * and పంపు, and `भेज` covers भेजो, भेजिए and भेजें. Romanised Telugu and Hindi
 * are whole words, because `pampandi` and `bhejo` are unlikely to hide inside
 * another word the way a Latin stem can.
 */
const ASK_SCRIPTS = [
  // Telugu: send, is wanted, give, share.
  "పంప",
  "కావాల",
  "ఇవ్వండి",
  "షేర్",
  // Hindi: send, is wanted, give, share.
  "भेज",
  "चाहिए",
  "चाहिये",
  "दीजिए",
  "दीजिये",
  "शेयर",
  // Tenglish.
  "pampandi",
  "pampava",
  "pampu",
  "pampin",
  "pampagalaru",
  "kavali",
  "kaavali",
  "kavala",
  "ivvandi",
  "ivvu",
  // Hinglish.
  "bhejo",
  "bhej",
  "bhejiye",
  "bhejna",
  "bhejdo",
  "chahiye",
  "chaiye",
  "dijiye",
  "dijye",
];

/**
 * Words that carry no evidence about which file was meant.
 *
 * The format words matter more than they look: without them "send me the PDF"
 * would score one point against every PDF the agent owns, and the tie-break
 * would quietly pick the newest one. A customer who names only a format has
 * named nothing, and the request falls through to an answer.
 *
 * `brochure` is deliberately NOT here. It is generic, but it is also the word
 * people use as a filename, so it is real evidence for which file was meant —
 * unlike `pdf`, which every file already shares.
 */
const NOISE = new Set([
  "a",
  "an",
  "the",
  "me",
  "my",
  "our",
  "us",
  "your",
  "of",
  "for",
  "to",
  "in",
  "on",
  "at",
  "is",
  "are",
  "do",
  "does",
  "did",
  "can",
  "could",
  "would",
  "will",
  "please",
  "pls",
  "kindly",
  "and",
  "or",
  "it",
  "this",
  "that",
  "some",
  "any",
  "one",
  "all",
  "copy",
  "pdf",
  "doc",
  "docx",
  "txt",
  "md",
  "csv",
  "xls",
  "xlsx",
  "file",
  "files",
  "document",
  "documents",
  "attachment",
  "details",
  "detail",
  "info",
  "information",
]);

function fold(text: string): string {
  // NFKC rather than NFKD: decomposing Telugu and Hindi would split the
  // consonants from their vowel signs, and a stem like `పంప` would stop
  // matching inside `పంపండి`.
  return text.normalize("NFKC").toLowerCase();
}

/** The words of a message or a filename that can identify a file. */
function matchTokens(text: string): Set<string> {
  const tokens = new Set<string>();

  for (const token of fold(text).split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < 2) continue;
    if (NOISE.has(token) || ASK.has(token)) continue;

    tokens.add(token);
  }

  return tokens;
}

/**
 * Whether the message is asking to be handed a file.
 *
 * Whole words for Latin script, because `sender` and `sendmail` are not
 * requests; plain containment for the Indic scripts and the romanised forms,
 * where the stems are long enough that a false hit inside another word would
 * be a coincidence worth accepting.
 */
export function wantsDocument(question: string): boolean {
  const text = fold(question ?? "");

  if (text.trim().length === 0) return false;

  for (const phrase of ASK_PHRASES) {
    if (text.includes(phrase)) return true;
  }

  for (const ask of ASK_SCRIPTS) {
    if (text.includes(ask)) return true;
  }

  for (const token of text.split(/[^\p{L}\p{N}]+/u)) {
    if (ASK.has(token)) return true;
  }

  return false;
}

/**
 * Shortest word compared fuzzily.
 *
 * At six letters a couple of edits is a typo — `brocher` for `brochure`. At
 * three it is a different word, and `duo` must never match `dua`.
 */
const NEAR_MIN = 6;

/**
 * Most edits still read as the same word.
 *
 * Two, because the typo customers actually type is two: `brocher` both drops the
 * `u` and swaps `er`. One would have refused the request this was built for.
 */
const NEAR_EDITS = 2;

/** Levenshtein distance, two rows at a time, over code points. */
function editsBetween(a: string, b: string): number {
  const left = [...a];
  const right = [...b];

  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  let current = new Array<number>(right.length + 1);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;

    for (let j = 1; j <= right.length; j += 1) {
      const substitution =
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1);

      current[j] = Math.min(substitution, previous[j] + 1, current[j - 1] + 1);
    }

    [previous, current] = [current, previous];
  }

  return previous[right.length];
}

/** Whether the filename contains this word, allowing a misspelling in a long one. */
function names(named: Set<string>, token: string): boolean {
  if (named.has(token)) return true;
  if (token.length < NEAR_MIN) return false;

  for (const candidate of named) {
    if (candidate.length < NEAR_MIN) continue;
    if (Math.abs(candidate.length - token.length) > NEAR_EDITS) continue;
    if (editsBetween(candidate, token) <= NEAR_EDITS) return true;
  }

  return false;
}

/**
 * The file the request names, or null when it names none.
 *
 * Ranked by shared words, not by similarity of the sentences: a filename is a
 * label, and the customer types the part of the label they remember. A tie is
 * settled by `updatedAt`, which is the operator's own answer to "which one is
 * current" — a brochure replaced this morning should win over last year's.
 *
 * `candidates` may arrive in any order; nothing here depends on it.
 *
 * Generic in the candidate type so a caller keeps whatever else it selected —
 * this decides *which* row, and the caller still needs the row's storage path.
 */
export function pickDocument<T extends FileCandidate>(
  question: string,
  candidates: T[],
): T | null {
  const asked = matchTokens(question);

  if (asked.size === 0) return null;

  let best: T | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const named = matchTokens(candidate.title);

    let score = 0;
    for (const token of asked) {
      if (names(named, token)) score += 1;
    }

    if (score === 0) continue;

    const better =
      score > bestScore ||
      (score === bestScore &&
        best !== null &&
        candidate.updatedAt.getTime() > best.updatedAt.getTime());

    if (better) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}