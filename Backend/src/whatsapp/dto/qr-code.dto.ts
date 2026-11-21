import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * Meta accepts up to 140 characters in the message a scan prefills. Rejecting
 * it here gives the customer a field-level error instead of a Graph refusal
 * that names no field.
 */
const PREFILLED_MAX = 140;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export const QR_FORMATS = ["SVG", "PNG"] as const;
export type QrFormat = (typeof QR_FORMATS)[number];

export class CreateQrCodeDto {
  /** What the customer's chat box is prefilled with after they scan. */
  @Transform(trimmed)
  @IsString()
  @MinLength(1, { message: "The prefilled message cannot be empty." })
  @MaxLength(PREFILLED_MAX, {
    message: `Meta allows at most ${PREFILLED_MAX} characters in a prefilled message.`,
  })
  prefilledMessage!: string;

  /**
   * SVG is the better default for print, but PNG is what most design tools
   * accept without a plugin, so both are offered rather than one assumed.
   */
  @IsOptional()
  @IsIn(QR_FORMATS, { message: "Image format is SVG or PNG." })
  format?: QrFormat;
}

export class UpdateQrCodeDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1, { message: "The prefilled message cannot be empty." })
  @MaxLength(PREFILLED_MAX, {
    message: `Meta allows at most ${PREFILLED_MAX} characters in a prefilled message.`,
  })
  prefilledMessage!: string;
}
