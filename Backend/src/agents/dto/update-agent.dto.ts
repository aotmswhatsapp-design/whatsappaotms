import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/** Every field optional: a form saves what changed, not the whole row. */
export class UpdateAgentDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(8_000)
  systemPrompt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(200)
  @Max(4_000)
  maxReplyChars?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  escalateKeywords?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
