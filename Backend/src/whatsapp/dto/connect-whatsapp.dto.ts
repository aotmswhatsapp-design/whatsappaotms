import { Transform } from "class-transformer";
import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

/**
 * Pasted credentials routinely arrive with a trailing newline or a stray
 * space; trimming before validation keeps that from reading as "invalid token".
 */
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** An empty optional field is absent, not invalid. */
const optionalTrimmed = ({ value }: { value: unknown }) => {
  if (typeof value !== "string") return value;

  const clean = value.trim();

  return clean.length > 0 ? clean : undefined;
};

/**
 * The five values a customer copies out of Meta. The verify token is not here
 * on purpose: the platform generates it, because a value the customer invents
 * is a value they can mistype into the other half of the handshake.
 */
export class ConnectWhatsAppDto {
  /** Permanent system-user token from Meta Business settings. */
  @Transform(trimmed)
  @IsString()
  @MinLength(20, { message: "Access token looks truncated." })
  @MaxLength(2048, { message: "Access token is too long to be a Meta token." })
  accessToken!: string;

  /** The "Phone number ID" of the WhatsApp Business number, not the number. */
  @Transform(trimmed)
  @IsString()
  @Matches(/^\d{5,25}$/, { message: "Phone number ID is numeric, e.g. 1098..." })
  phoneNumberId!: string;

  /**
   * App settings → Basic → App secret. Thirty-two hex characters on every app
   * Meta has issued in the last several years; the length window is wider than
   * that so a differently-formatted secret is not rejected before it is tried.
   */
  @Transform(trimmed)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{16,128}$/, {
    message: "App secret is 16–128 letters, digits, dashes or underscores.",
  })
  appSecret!: string;

  /** Graph API version, e.g. v23.0. */
  @Transform(trimmed)
  @IsString()
  @Matches(/^v\d{1,2}\.\d$/, { message: "Graph version looks like v23.0." })
  graphVersion!: string;

  /**
   * App settings → Basic → App ID.
   *
   * Not a secret and not a duplicate of the token: Meta's Resumable Upload API
   * is addressed by app id and rejects a token minted by a different app, so
   * the number's own app has to be named. Optional because a connection that
   * never sends an image header works without it — the templates screen says
   * so in one sentence when it is missing.
   */
  @IsOptional()
  @Transform(optionalTrimmed)
  @IsString()
  @Matches(/^\d{6,25}$/, { message: "App ID is numeric, e.g. 1207..." })
  appId?: string;

  /** WhatsApp Business Account (WABA) id, not the Business Manager id. */
  @Transform(trimmed)
  @IsString()
  @Matches(/^\d{5,25}$/, { message: "Whatsapp Account ID is numeric, e.g. 1022..." })
  businessAccountId!: string;
}
