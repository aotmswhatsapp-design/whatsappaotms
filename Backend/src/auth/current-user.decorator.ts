import {
  UnauthorizedException,
  createParamDecorator,
  type ExecutionContext,
} from "@nestjs/common";

import type { AuthClaims, AuthenticatedRequest } from "./auth.types";

/**
 * `@CurrentUser()` resolves to the verified claims. It throws rather than
 * returning undefined so a controller can never accidentally act anonymously.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthClaims => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.auth) {
      throw new UnauthorizedException("Request is not authenticated");
    }

    return request.auth;
  },
);
