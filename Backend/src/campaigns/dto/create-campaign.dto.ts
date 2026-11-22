import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";

/** A pasted name arrives with stray whitespace; it would be stored literally. */
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class CreateCampaignDto {
  @Transform(trimmed)
  @IsString({ message: "Give the campaign a name." })
  @Length(1, 120, { message: "A campaign name is 1 to 120 characters." })
  name!: string;

  /** The `MessageTemplate` row, not Meta's id: the row carries the components. */
  @IsUUID(undefined, { message: "Choose an approved template." })
  templateId!: string;

  /** Any-of tags. Empty means every contact in the workspace. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: "Pick at most 20 tags." })
  @IsString({ each: true })
  audienceTags?: string[];

  /** Token without braces → how it is filled. Parsed by `bindingsOf`. */
  @IsOptional()
  @IsObject({ message: "Variables arrive as a map of token to binding." })
  variables?: Record<string, unknown>;

  /** Button index → the address that URL button opens. */
  @IsOptional()
  @IsObject({ message: "Button links arrive as a map of addresses." })
  buttonUrls?: Record<string, unknown>;

  @IsOptional()
  @IsISO8601({}, { message: "Give the schedule a valid date and time." })
  scheduledAt?: string;

  /** Meta requires opt-in for marketing; this is the agent's acknowledgement. */
  @IsOptional()
  @IsBoolean()
  optInConfirmed?: boolean;
}
