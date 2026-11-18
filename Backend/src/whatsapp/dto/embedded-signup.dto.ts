import { Transform } from "class-transformer";
import { IsString, Matches, MaxLength, MinLength } from "class-validator";

/**
 * Meta's dialog posts its result to the browser, which then forwards the three
 * values here. They are trimmed first so a stray space from copy-paste is not
 * reported as an invalid code.
 */
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/**
 * What the browser collected from Meta's Embedded Signup dialog. No token and
 * no secret: the code is traded for a token server-side, so the customer never
 * handles a credential at all.
 */
export class EmbeddedSignupDto {
  /** Single-use, expires in minutes. */
  @Transform(trimmed)
  @IsString()
  @MinLength(10, { message: "The signup code looks truncated. Try the button again." })
  @MaxLength(2048, { message: "The signup code is too long to be a Meta code." })
  code!: string;

  /** WhatsApp Account id chosen inside the dialog. */
  @Transform(trimmed)
  @IsString()
  @Matches(/^\d{5,25}$/, { message: "WhatsApp Account ID is numeric, e.g. 1022..." })
  wabaId!: string;

  /** The number's id, not the number itself. */
  @Transform(trimmed)
  @IsString()
  @Matches(/^\d{5,25}$/, { message: "Phone number ID is numeric, e.g. 1098..." })
  phoneNumberId!: string;
}
