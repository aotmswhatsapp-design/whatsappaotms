import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { ConfirmationsService } from "./confirmations.service";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import { SupabaseTokenVerifier } from "./supabase-token-verifier.service";
import { UsersService } from "./users.service";

@Module({
  controllers: [AuthController],
  providers: [
    SupabaseTokenVerifier,
    SupabaseAuthGuard,
    UsersService,
    AuthService,
    ConfirmationsService,
  ],
  // Exported so later modules can guard their own controllers with the same
  // token verifier instead of inventing a second one.
  exports: [SupabaseAuthGuard, SupabaseTokenVerifier, UsersService],
})
export class AuthModule {}
