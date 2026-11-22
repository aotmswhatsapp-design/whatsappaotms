import { Transform } from "class-transformer";
import { Matches } from "class-validator";

export class TestCampaignDto {
  /** Digits only, the way Meta names a customer. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.replace(/\D/g, "") : value,
  )
  @Matches(/^\d{6,15}$/, {
    message: "Give a WhatsApp number in international format.",
  })
  to!: string;
}
