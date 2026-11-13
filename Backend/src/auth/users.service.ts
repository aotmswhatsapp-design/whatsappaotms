import { Injectable, UnauthorizedException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type { AuthClaims } from "./auth.types";

function pickString(
  source: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

/**
 * The local mirror of a Supabase user. Supabase owns credentials; this row
 * exists so business tables can hold real foreign keys.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates or refreshes the row from the verified token claims. Called by
   * /auth/me rather than by the guard, so a read-only request does not turn
   * into a write on every call.
   */
  async syncFromClaims(claims: AuthClaims) {
    const email = claims.email?.trim().toLowerCase();

    if (!email) {
      throw new UnauthorizedException("Access token is missing an email claim");
    }

    const fullName = pickString(
      claims.metadata,
      "full_name",
      "name",
      "display_name",
    );
    const avatarUrl = pickString(
      claims.metadata,
      "avatar_url",
      "picture",
      "avatar",
    );

    return this.prisma.user.upsert({
      where: { id: claims.id },
      create: {
        id: claims.id,
        email,
        fullName,
        avatarUrl,
        lastSeenAt: new Date(),
      },
      update: {
        email,
        lastSeenAt: new Date(),
        // Only overwrite when the provider actually supplied a value —
        // otherwise a Google-less login would blank a name set elsewhere.
        ...(fullName ? { fullName } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
        lastSeenAt: true,
      },
    });
  }
}
