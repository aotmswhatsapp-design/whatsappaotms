import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ArrayMaxSize,
} from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/** The two models verified on this key. An unknown one is a 400, not a 502. */
export const AGENT_MODELS = ["gpt-5.4-mini", "gpt-4.1-mini"] as const;

export class CreateAgentDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "Give the agent a name." })
  @MaxLength(80)
  name!: string;

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
  @IsIn(AGENT_MODELS)
  model?: (typeof AGENT_MODELS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1.2)
  temperature?: number;

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
}
