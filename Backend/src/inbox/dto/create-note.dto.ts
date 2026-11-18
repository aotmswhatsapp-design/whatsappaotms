import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** Internal note: never sent to the customer, so no WhatsApp limits apply. */
export class CreateNoteDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1, { message: "Write something before saving the note." })
  @MaxLength(2000, { message: "Notes are at most 2000 characters." })
  body!: string;
}
