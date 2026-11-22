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
