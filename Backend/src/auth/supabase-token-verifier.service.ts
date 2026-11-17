import {
  Injectable,
  Logger,
  UnauthorizedException,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

import type { AuthClaims } from "./auth.types";

/**
 * Verifies Supabase access tokens.
 *
 * Newer projects sign with an asymmetric key published at the project JWKS, so
 * that is the default. Projects still on the legacy shared secret can set
 * SUPABASE_JWT_SECRET and the HS256 path takes over.
 */
@Injectable()
export class SupabaseTokenVerifier implements OnModuleInit {
  private readonly logger = new Logger(SupabaseTokenVerifier.name);
  private readonly issuer: string;
  private readonly audience = "authenticated";
  private readonly secret?: Uint8Array;
  private jwks?: JWTVerifyGetKey;

  constructor(config: ConfigService) {
    const projectUrl = config
      .getOrThrow<string>("SUPABASE_URL")
      .replace(/\/+$/, "");
    this.issuer = `${projectUrl}/auth/v1`;

    const sharedSecret = config.get<string>("SUPABASE_JWT_SECRET");
    if (sharedSecret) {
      this.secret = new TextEncoder().encode(sharedSecret);
    }
  }

  onModuleInit(): void {
    // Built even when a legacy secret is configured: `verify` decides per
    // token, and a project that has moved to signing keys still needs this.
    this.jwks = createRemoteJWKSet(
      new URL(`${this.issuer}/.well-known/jwks.json`),
    );

    this.logger.log(
      this.secret
        ? "Access tokens: project JWKS, with the legacy HS256 secret as a fallback"
        : "Access tokens verified with the project JWKS",
    );
  }

  async verify(token: string): Promise<AuthClaims> {
    const options = {
      issuer: this.issuer,
      audience: this.audience,
      // Small leeway for clock drift between here and Supabase.
      clockTolerance: 5,
    };

    let payload: JWTPayload;
    try {
      // The algorithm the token declares decides the key source, so a leftover
      // HS256 secret cannot lock out a project that has moved to ES256 signing
      // keys — which is exactly what the Supabase migration produced.
      const { alg } = decodeProtectedHeader(token);

      if (alg === "HS256" && this.secret) {
        ({ payload } = await jwtVerify(token, this.secret, {
          ...options,
          algorithms: ["HS256"],
        }));
      } else if (this.jwks) {
        ({ payload } = await jwtVerify(token, this.jwks, {
          ...options,
          algorithms: ["ES256", "RS256"],
        }));
      } else {
        throw new Error("No key source configured");
      }
    } catch (error) {
      this.logger.debug(
        `Rejected access token: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
      throw new UnauthorizedException("Invalid or expired access token");
    }

    if (!payload.sub) {
      throw new UnauthorizedException("Access token is missing a subject");
    }

    return {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      role: typeof payload.role === "string" ? payload.role : "authenticated",
      metadata:
        payload.user_metadata && typeof payload.user_metadata === "object"
          ? (payload.user_metadata as Record<string, unknown>)
          : {},
    };
  }
}
