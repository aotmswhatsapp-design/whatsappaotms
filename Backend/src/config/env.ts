import { z } from "zod";

/**
 * A port that a hosting dashboard may leave blank. `APP_PORT=` in a dashboard
 * arrives as an empty string, and coerce.number turns that into 0 — which the
 * range check then rejects at boot. An empty value means "not set".
 */
const optionalPort = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().int().min(1).max(65_535).optional(),
);

/**
 * Fail fast on a bad environment. A missing SUPABASE_URL otherwise surfaces as
 * a confusing 401 for every request instead of a startup error.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  /**
   * Deliberately not `PORT` on its own: on Windows environment keys are
   * case-insensitive, so a stray lowercase `port=5432` in .env would shadow
   * `PORT` and the API would try to bind the database port. APP_PORT therefore
   * wins when it is set, and `PORT` is only the fallback.
   */
  APP_PORT: optionalPort,
  /**
   * Injected by hosting platforms (Render sets this on every web service).
   * Ignored whenever APP_PORT is present, so a local .env keeps control.
   */
  PORT: optionalPort,
  SUPABASE_URL: z.string().url(),
  /**
   * Keys for the auth REST API. Both are optional so the API still boots for a
   * caller that only needs token verification; the features that require them
   * (confirm/resend) answer 503 instead of failing at startup.
   *
   * Supabase's new key format is `sb_publishable_…` / `sb_secret_…`; the
   * legacy anon and service_role JWTs are accepted under either name.
   */
  SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(20)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  SUPABASE_SECRET_KEY: z
    .string()
    .min(20)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /**
   * Legacy symmetric signing only. Leave unset on a project that publishes a
   * JWKS: an ES256 project plus an HS256 secret means nothing verifies.
   */
  SUPABASE_JWT_SECRET: z
    .string()
    .min(32)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  SUPABASE_POSTGRES_URL: z.string().min(1),
  /**
   * Any high-entropy string. It is hashed to a 32-byte AES-256-GCM key, so the
   * length only has to be long enough to be worth hashing.
   */
  WHATSAPP_ENCRYPTION_KEY: z.string().min(32),
  /**
   * The public URL Meta posts to: `<api origin>/api/v1/whatsapp/webhook`.
   * Optional so a local API still boots; when it is unset the connection screen
   * says the callback is not configured instead of inventing one.
   */
  WHATSAPP_WEBHOOK_PUBLIC_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** Test seam: point this at a local Graph stub to prove the success path. */
  META_GRAPH_BASE_URL: z.string().url().default("https://graph.facebook.com"),
  /**
   * The Meta app that owns the tokens this deployment stores. Only the
   * template sample upload needs it: the Resumable Upload API is addressed as
   * `/{app-id}/uploads`. Optional so the API still boots without it — a
   * template with an image header then answers 503 with that sentence instead
   * of guessing an id and letting Meta reject the upload.
   */
  META_APP_ID: z
    .string()
    .regex(/^\d+$/, "META_APP_ID is a numeric app id")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /**
   * Embedded Signup's platform app secret. It signs the OAuth code exchange and
   * every delivery from a connection created through the dialog. Optional, like
   * META_APP_ID, so a manual-only deployment still boots.
   */
  META_APP_SECRET: z
    .string()
    .min(10)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** The "Facebook Login for Business" configuration that carries Embedded Signup. */
  META_ES_CONFIG_ID: z
    .string()
    .regex(/^\d{6,}$/, "META_ES_CONFIG_ID is a numeric configuration id")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** Version the platform app calls: code exchange, subscribed_apps, debug_token. */
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d{1,2}\.\d$/, "META_GRAPH_VERSION looks like v27.0")
    .default("v27.0"),
  /**
   * The token typed into the app's single Webhooks panel. With a platform app
   * Meta verifies the callback URL once for the whole deployment, so there is
   * no per-workspace token to match for signup rows.
   */
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z
    .string()
    .min(8)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  CORS_ORIGINS: z.string().optional(),
  /**
   * Private Supabase Storage bucket for inbox attachments. Created on the
   * first upload; left as the default so a deployment needs no new setting.
   */
  INBOX_MEDIA_BUCKET: z.string().min(1).default("inbox-media"),
  /**
   * Private bucket for template sample images. Separate from the inbox bucket
   * because a template's sample outlives every conversation and is never
   * purged with one.
   */
  TEMPLATE_MEDIA_BUCKET: z.string().min(1).default("template-media"),
  /**
   * PUBLIC bucket for chatbot card pictures. Public because the address is
   * stored on the card and fetched by Meta when the card is shown — often
   * weeks after the upload — so a signed link would already have expired.
   */
  BOT_MEDIA_BUCKET: z.string().min(1).default("bot-media"),
  /**
   * The trigram floor for the local engine, on `word_similarity`'s 0–1 scale.
   * A word that appears verbatim in a chunk scores far above 0.5, which is why
   * this measures a word, not a document.
   */
  SEARCH_MIN_TRGM: z.coerce.number().min(0).max(1).default(0.5),
  /**
   * The key that lets a model write the reply.
   *
   * Optional on purpose: with no key the reply path keeps its extractive
   * answer, so a deployment without a model still answers customers, and the
   * suite runs without a network. The name carries an underscore after OPEN —
   * a key under any other spelling is read by nothing and fails silently.
   */
  OPEN_ROUTER_API_KEY: z
    .string()
    .min(20)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  /**
   * Used when an agent names no model of its own, spelled `vendor/model`.
   *
   * The free router is the default because the common case is an account with
   * no credits: `openai/gpt-4o` and `openrouter/auto` both answer 402 there on
   * every call, which is invisible — the reply path quietly falls back to the
   * extractive answer and nobody is told why. `openrouter/free` routes across
   * the zero-cost models and needs nothing on deposit. Once credits exist,
   * `openai/gpt-4o` is the better default: set it here or per agent.
   */
  OPENROUTER_MODEL: z.string().min(3).default("openrouter/free"),
  /** Sent as HTTP-Referer. OpenRouter uses it for attribution, not for auth. */
  OPENROUTER_SITE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  OPENROUTER_SITE_NAME: z.string().min(1).default("AOTMS"),
  /**
   * One reply's budget. Capped at 14 s because a customer waits for it behind a
   * one-second worker tick, and the promise to the business is fifteen.
   */
  OPENROUTER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(14_000)
    .default(10_000),
  /**
   * Private bucket for training files. Third of its kind, created on first
   * upload, and separate because a source outlives every conversation.
   */
  AGENT_SOURCE_BUCKET: z.string().min(1).default("agent-sources"),
  /**
   * The largest training file, in bytes. The multipart interceptor enforces a
   * hard 25 MB ceiling that no setting can raise; this can only lower it.
   */
  KNOWLEDGE_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),
  /**
   * A document may take this long to read and embed before it is stopped. A
   * 1,200-chunk price book is forty paid calls; without a ceiling one stalled
   * provider holds the source's claim indefinitely.
   */
  KNOWLEDGE_JOB_BUDGET_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 60 * 1000),
  /**
   * Retention for the connection status: within this window a page load reads
   * the stored verdict instead of calling Graph again.
   */
  WHATSAPP_STATUS_TTL_MS: z.coerce.number().int().min(0).default(300_000),
  /** Global per-IP ceiling: requests per window, and the window in ms. */
  THROTTLE_TTL_MS: z.coerce.number().int().min(1_000).default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  return parsed.data;
}

/**
 * Explicit config wins over the platform's injected `PORT`, which in turn wins
 * over the development default. Without the middle step a deploy binds 4000
 * while the platform routes to `$PORT`, and every request 502s.
 */
export function resolvePort(
  appPort: number | undefined,
  platformPort: number | undefined,
): number {
  return appPort ?? platformPort ?? 4000;
}

export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
