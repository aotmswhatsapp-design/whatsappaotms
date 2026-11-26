import { IsOptional, IsString, IsUUID, MinLength, Allow } from "class-validator";

/**
 * A flow and the card to show from it.
 *
 * `flow` is accepted as it arrives and then read by `snapshotIn`, which is the
 * same function that reads it back out of `messages.payload`. Validating it a
 * second time with a schema of its own would let the two disagree: a payload
 * that passed the check and a payload that was stored are the same object, so
 * there is exactly one reader to be wrong.
 */
export class SendCardDto {
  @Allow()
  flow!: unknown;

  @IsString()
  @MinLength(1, { message: "Name the card to send." })
  cardId!: string;

  /** Same contract as a text reply: a row id from this conversation. */
  @IsOptional()
  @IsUUID(undefined, { message: "That message cannot be quoted." })
  quotedMessageId?: string;
}
