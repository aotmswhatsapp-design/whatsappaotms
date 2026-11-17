import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Re-sends Supabase's sign-up confirmation mail.
 *
 * Two rules shape this class:
 *
 * 1. The caller never learns whether an address exists. Supabase answers the
 *    same way either way, and this method always reports "accepted" even when
 *    the provider rejected the request — only the server log records that.
 * 2. A deployment without a publishable key says so out loud. Silently
 *    pretending the mail went out would leave a customer waiting forever.
 */
@Injectable()
export class ConfirmationsService {
  private readonly logger = new Logger(ConfirmationsService.name);
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(config: ConfigService) {
    this.baseUrl = config
      .getOrThrow<string>("SUPABASE_URL")
      .replace(/\/+$/, "");
    this.apiKey = config.get<string>("SUPABASE_PUBLISHABLE_KEY");
  }

  async resend(email: string): Promise<{ accepted: true }> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        "Resending confirmation email is not configured on this server. Sign in to request a new code.",
      );
    }

    try {
      const response = await fetch(`${this.baseUrl}/auth/v1/resend`, {
        method: "POST",
        headers: {
          apikey: this.apiKey,
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "signup", email }),
        signal: AbortSignal.timeout(8_000),
      });

      if (!response.ok) {
        // Status only: the body echoes the address and the provider's internals.
        this.logger.warn(
          `Supabase resend rejected the request with ${response.status}`,
        );
      }
    } catch (error) {
      // A timeout or DNS failure must not turn into a 500 for the customer —
      // they would just retry, and the next attempt may well succeed.
      this.logger.warn(
        `Supabase resend could not be reached: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }

    return { accepted: true };
  }
}
