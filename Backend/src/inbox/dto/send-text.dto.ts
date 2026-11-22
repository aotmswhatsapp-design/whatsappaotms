import { Transform } from "class-transformer";
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

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

  /**
   * The message this reply quotes. A row id, not a wamid: the server decides
   * which wamid that is, and refuses one from another conversation.
   */
  @IsOptional()
  @IsUUID(undefined, { message: "That message cannot be quoted." })
  quotedMessageId?: string;
}
