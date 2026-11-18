import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  /**
   * An optional machine-readable discriminator, e.g. `WINDOW_CLOSED`. The
   * client switches on this instead of matching an English sentence.
   */
  code?: string;
  path: string;
  timestamp: string;
}

/**
 * One error shape for the whole API, so the frontend never has to guess
 * between Nest's default body, a Prisma failure and an unhandled crash.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message, error, code } = this.describe(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      error,
      message,
      ...(code ? { code } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }

  private describe(exception: unknown): {
    status: number;
    message: string | string[];
    error: string;
    code?: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === "string"
          ? payload
          : ((payload as { message?: string | string[] }).message ??
            exception.message);

      const code =
        typeof payload === "object" && payload !== null
          ? (payload as { code?: unknown }).code
          : undefined;

      return {
        status,
        message,
        error: HttpStatus[status] ?? "Error",
        ...(typeof code === "string" && code.length > 0 ? { code } : {}),
      };
    }

    // Translate the constraint failures a client can actually trigger.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2002") {
        return {
          status: HttpStatus.CONFLICT,
          message: "That value is already taken.",
          error: "CONFLICT",
        };
      }
      if (exception.code === "P2025") {
        return {
          status: HttpStatus.NOT_FOUND,
          message: "The requested record does not exist.",
          error: "NOT_FOUND",
        };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Something went wrong on our side.",
      error: "INTERNAL_SERVER_ERROR",
    };
  }
}
