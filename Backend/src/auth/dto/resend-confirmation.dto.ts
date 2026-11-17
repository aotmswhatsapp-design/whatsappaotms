import { Transform } from "class-transformer";
import { IsEmail, MaxLength } from "class-validator";

/**
 * Addresses are lower-cased before they reach Supabase: the provider treats
 * them case-insensitively anyway, and a normalised value keeps the logs and
 * any future dedupe honest.
 */
const normalised = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class ResendConfirmationDto {
  @Transform(normalised)
  @IsEmail({}, { message: "That email address doesn't look right." })
  @MaxLength(254, { message: "That email address is too long." })
  email!: string;
}
