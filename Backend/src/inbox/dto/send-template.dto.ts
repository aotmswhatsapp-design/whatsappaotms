import { Transform, Type } from "class-transformer";
import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";

/** A pasted value arrives with stray whitespace; Meta would take it literally. */
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/**
 * Only string values are meaningful in a token map. Anything else is dropped
 * rather than forwarded, so a number or a nested object can never reach Meta;
 * the missing value then reads as "fill this in" like any other blank.
 */
const stringsOnly = ({ value }: { value: unknown }) =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(([, entry]) => typeof entry === "string"),
      )
    : value;

/** The `tap_target_configuration` override. */
export class TapTargetDto {
  @Transform(trimmed)
  @IsString({ message: "Give the tap target a title." })
  title!: string;

  @Transform(trimmed)
  @IsString({ message: "The tap target needs an address." })
  url!: string;
}

export class SendTemplateDto {
  /** The `MessageTemplate` row, not Meta's id: the row carries the components. */
  @IsUUID(undefined, { message: "Unknown template." })
  templateId!: string;

  /** Token without braces (`1`, `first_name`) → the value to fill in. */
  @IsOptional()
  @Transform(stringsOnly)
  @IsObject({ message: "Variables arrive as a map of values." })
  variables?: Record<string, string>;

  /** Button index → the full address that URL button opens. */
  @IsOptional()
  @Transform(stringsOnly)
  @IsObject({ message: "Button links arrive as a map of addresses." })
  buttonUrls?: Record<string, string>;

  @IsOptional()
  @ValidateNested()
  @Type(() => TapTargetDto)
  tapTarget?: TapTargetDto;
}
