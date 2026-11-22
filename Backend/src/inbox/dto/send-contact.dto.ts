import { Transform } from "class-transformer";
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

/** A blank field means "leave it out of the card", not an empty string. */
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? (value.trim() === "" ? undefined : value.trim()) : value;

/**
 * One contact card.
 *
 * A name is the only thing WhatsApp insists on; a phone is what makes the card
 * useful, so the UI asks for both while the API accepts either.
 */
export class SendContactDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1, { message: "Give the contact a name." })
  @MaxLength(120, { message: "A contact name is at most 120 characters." })
  name!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(/^\+?[0-9][0-9 ()-]{4,19}$/, {
    message: "Use an international phone number, like +91 98765 43210.",
  })
  phone?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsEmail({}, { message: "That does not look like an email address." })
  email?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  organization?: string;
}
