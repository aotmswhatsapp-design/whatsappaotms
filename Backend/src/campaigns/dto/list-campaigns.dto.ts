import { Transform } from "class-transformer";
import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";
import { CampaignStatus } from "@prisma/client";

export class ListCampaignsDto {
  @IsOptional()
  @IsEnum(CampaignStatus, { message: "Unknown campaign status." })
  status?: CampaignStatus;
}

/**
 * `?tags=a,b` — a comma-separated list is what a query string can carry
 * without repeating a key, and it is what the audience chips already produce.
 */
export class AudienceQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string"
      ? [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))]
      : value,
  )
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
