import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";

import type { AuthenticatedRequest } from "./auth.types";
import { SupabaseTokenVerifier } from "./supabase-token-verifier.service";

/**
 * Bearer-token guard. The browser holds the Supabase session, so the API never
 * sees a password — it only checks a signature and attaches the claims.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly verifier: SupabaseTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException(
        "Send an Authorization: Bearer <access token> header",
      );
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      throw new UnauthorizedException("Empty bearer token");
    }

    request.auth = await this.verifier.verify(token);
    return true;
  }
}
