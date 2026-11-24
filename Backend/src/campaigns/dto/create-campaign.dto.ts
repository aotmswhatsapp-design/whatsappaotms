import { Transform, Type } from "class-transformer";
import { AudienceSource } from "@prisma/client";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from "class-validator";

import { MAX_IMPORT_ROWS, RecipientRowDto } from "./add-recipients.dto";

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

  /**
   * Who this reaches. `LIST` — the default here, unlike the column default —
   * is the numbers typed or imported in the panel; `SEGMENT` is the tag query
   * that predates it. A campaign sends to one or the other, never to both.
   */
  @IsOptional()
  @IsEnum(AudienceSource, { message: "Choose how the audience is picked." })
  audienceSource?: AudienceSource;

  /** The numbers of a `LIST` campaign, sent with the campaign in one call. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IMPORT_ROWS, {
    message: `One import carries at most ${MAX_IMPORT_ROWS} rows. Split the file and add the rest.`,
  })
  @ValidateNested({ each: true })
  @Type(() => RecipientRowDto)
  recipients?: RecipientRowDto[];

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
