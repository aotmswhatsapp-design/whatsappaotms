import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from "class-validator";

/** A spreadsheet cell arrives as text; a stray newline is not a value. */
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/**
 * One line of the list.
 *
 * Only `phone` is required, and only loosely: the number is cleaned and checked
 * by `normaliseWaId`, which can explain a bad one far better than a validation
 * message can. Name, email and identity are labels for the agent — no template
 * parameter reads them today — so an empty cell is not a reason to refuse a
 * customer who can be messaged.
 */
export class RecipientRowDto {
  @Transform(trimmed)
  @IsString({ message: "A phone number arrives as text." })
  @Length(1, 40, { message: "A phone number is 1 to 40 characters." })
  phone!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(0, 120, { message: "A name is at most 120 characters." })
  name?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(0, 160, { message: "An email is at most 160 characters." })
  email?: string;

  /** The customer's own reference: membership, order, CRM id. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(0, 120, { message: "An identity is at most 120 characters." })
  identity?: string;
}

/** The ceiling one import may carry. The form splits a larger file. */
export const MAX_IMPORT_ROWS = 5_000;

export class AddRecipientsDto {
  @IsArray({ message: "Send the rows as a list." })
  @ArrayMinSize(1, { message: "Add at least one row." })
  @ArrayMaxSize(MAX_IMPORT_ROWS, {
    message: `One import carries at most ${MAX_IMPORT_ROWS} rows. Split the file and add the rest.`,
  })
  @ValidateNested({ each: true })
  @Type(() => RecipientRowDto)
  recipients!: RecipientRowDto[];
}
