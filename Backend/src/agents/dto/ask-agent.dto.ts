import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";

export class AskAgentDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: "Type a question." })
  @MaxLength(2_000)
  question!: string;
}
