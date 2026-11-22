import { IsString, IsUUID, MaxLength } from "class-validator";

/**
 * One emoji on one message.
 *
 * An empty `emoji` is not a mistake — it is how Meta removes a reaction, and
 * the only way an agent can take one back.
 */
export class SendReactionDto {
  @IsUUID(undefined, { message: "React to a message in this conversation." })
  messageId!: string;

  @IsString()
  @MaxLength(16, { message: "A reaction is a single emoji." })
  emoji!: string;
}
