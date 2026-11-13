import { z } from "zod";

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
  APP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  /**
   * Injected by hosting platforms (Render sets this on every web service).
   * Ignored whenever APP_PORT is present, so a local .env keeps control.
   */
  PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  SUPABASE_URL: z.string().url(),
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
  /** Test seam: point this at a local Graph stub to prove the success path. */
  META_GRAPH_BASE_URL: z.string().url().default("https://graph.facebook.com"),
  CORS_ORIGINS: z.string().optional(),
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
