import { Transform } from "class-transformer";
import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * Pasted credentials routinely arrive with a trailing newline or a stray
 * space; trimming before validation keeps that from reading as "invalid token".
 */
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

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

  /** Our own shared secret; Meta echoes it back during the webhook handshake. */
  @Transform(trimmed)
  @IsString()
  @MinLength(8, { message: "Verify token needs at least 8 characters." })
  @MaxLength(128, { message: "Verify token must be 128 characters or fewer." })
  verifyToken!: string;

  /** Graph API version, e.g. v21.0. */
  @Transform(trimmed)
  @IsString()
  @Matches(/^v\d{1,2}\.\d$/, { message: "Graph version looks like v21.0." })
  graphVersion!: string;

  /** WhatsApp Business Account (WABA) id, not the Business Manager id. */
  @Transform(trimmed)
  @IsString()
  @Matches(/^\d{5,25}$/, { message: "Business account ID is numeric, e.g. 1022..." })
  businessAccountId!: string;
}
