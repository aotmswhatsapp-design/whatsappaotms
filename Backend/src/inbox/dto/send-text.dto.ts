import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";

/** A pasted body arrives with stray whitespace; WhatsApp would send it. */
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class SendTextDto {
  /** WhatsApp's own ceiling for a text body. */
  @Transform(trimmed)
  @IsString()
  @MinLength(1, { message: "Type a message before sending." })
  @MaxLength(4096, { message: "WhatsApp messages are at most 4096 characters." })
  body!: string;
}
