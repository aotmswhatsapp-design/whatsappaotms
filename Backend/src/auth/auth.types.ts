import type { Request } from "express";

/** The subset of the Supabase access-token payload this API relies on. */
export interface AuthClaims {
  /** `sub` — the Supabase user id. */
  id: string;
  email?: string;
  /** Supabase's own role claim ("authenticated", "service_role", …). */
  role: string;
  metadata: Record<string, unknown>;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthClaims;
}
