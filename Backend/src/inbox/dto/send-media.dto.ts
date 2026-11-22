import { Transform } from "class-transformer";
import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** The optional caption on a multipart upload; the file is the other part. */
export class SendMediaDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1024, { message: "A media caption is at most 1024 characters." })
  caption?: string;

  /** The message this attachment quotes, when it answers one. */
  @IsOptional()
  @IsUUID(undefined, { message: "That message cannot be quoted." })
  quotedMessageId?: string;
}
