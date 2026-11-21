import { Transform } from "class-transformer";
import {
  IsOptional,
  IsString,
  IsTimeZone,
  Matches,
  MaxLength,
} from "class-validator";

/**
 * A cleared field arrives as an empty string from an input a person emptied, so
 * a blank becomes `null` — which `@IsOptional` then skips — instead of failing
 * a format rule the user cannot satisfy.
 */
const blankToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

/**
 * The workspace's own identity. Every field is optional because this is a PATCH:
 * a form that changes one field must not be forced to resend the others.
 */
export class UpdateBusinessProfileDto {
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: "Company name is at most 120 characters." })
  companyName?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^https?:\/\/[^\s]+\.[^\s]+$/i, {
    message: "Website must start with http:// or https://.",
  })
  website?: string | null;

  /**
   * A region name, not an offset: an offset cannot survive a daylight-saving
   * change, and scheduled sends are the reason this field exists.
   */
  @Transform(blankToNull)
  @IsOptional()
  @IsTimeZone({ message: "Use an IANA timezone, e.g. Asia/Kolkata." })
  timezone?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^\+?[0-9][0-9 ()-]{4,30}$/, {
    message: "Support number is digits, spaces, dashes and brackets.",
  })
  supportNumber?: string | null;
}
