import { Transform } from "class-transformer";
import { AudienceSource } from "@prisma/client";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from "class-validator";

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/**
 * A draft is the only editable thing. The template itself is not on this DTO:
 * a campaign is one template sent once, so changing it would be a new campaign
 * wearing the old one's counts.
 */
export class UpdateCampaignDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString({ message: "Give the campaign a name." })
  @Length(1, 120, { message: "A campaign name is 1 to 120 characters." })
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: "Pick at most 20 tags." })
  @IsString({ each: true })
  audienceTags?: string[];

  /**
   * Switching a tag campaign to a list is how an older draft gains numbers;
   * the reverse is refused while recipient rows exist, because those rows are
   * the audience the campaign would otherwise silently stop reaching.
   */
  @IsOptional()
  @IsEnum(AudienceSource, { message: "Choose how the audience is picked." })
  audienceSource?: AudienceSource;

  @IsOptional()
  @IsObject({ message: "Variables arrive as a map of token to binding." })
  variables?: Record<string, unknown>;

  @IsOptional()
  @IsObject({ message: "Button links arrive as a map of addresses." })
  buttonUrls?: Record<string, unknown>;

  /** `null` unschedules and returns the campaign to DRAFT. */
  @IsOptional()
  @IsISO8601({}, { message: "Give the schedule a valid date and time." })
  scheduledAt?: string | null;
}
