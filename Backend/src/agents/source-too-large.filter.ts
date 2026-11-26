import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  PayloadTooLargeException,
} from "@nestjs/common";

import { HttpExceptionFilter } from "../common/filters/http-exception.filter";
import { MAX_SOURCE_BYTES } from "./knowledge.file";

/**
 * One limit must not have two bodies.
 *
 * Multer refuses a body over the interceptor's ceiling before any handler runs,
 * and Nest turns that into a bare `PayloadTooLargeException("File too large")`
 * with no `code`. The service's own size refusal is already `SOURCE_TOO_LARGE`.
 * This restates Multer's error in that shape, and passes the service's error
 * through untouched — its message names the limit actually configured, which
 * may be lower than the interceptor's.
 */
@Catch(PayloadTooLargeException)
export class SourceTooLargeFilter implements ExceptionFilter {
  // Reused rather than copied: one error body for the whole API, including the
  // `statusCode`/`error`/`path`/`timestamp` fields this file would otherwise
  // have to keep in step by hand.
  private readonly shape = new HttpExceptionFilter();

  catch(exception: PayloadTooLargeException, host: ArgumentsHost): void {
    this.shape.catch(this.otherwise(exception), host);
  }

  private otherwise(
    exception: PayloadTooLargeException,
  ): PayloadTooLargeException {
    const payload = exception.getResponse();

    const coded =
      typeof payload === "object" &&
      payload !== null &&
      (payload as { code?: unknown }).code === "SOURCE_TOO_LARGE";

    if (coded) return exception;

    return new PayloadTooLargeException({
      code: "SOURCE_TOO_LARGE",
      message: `Training files are limited to ${Math.round(MAX_SOURCE_BYTES / (1024 * 1024))} MB.`,
    });
  }
}
