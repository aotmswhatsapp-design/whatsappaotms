import { Transform, Type } from "class-transformer";
import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? (value.trim() === "" ? undefined : value.trim()) : value;

/**
 * A location pin. The numbers arrive from a form, so they are coerced before
 * Meta's own ranges are asserted — a latitude of 91 is refused here, not by a
 * 400 that quotes none of the fields.
 */
export class SendLocationDto {
  @Type(() => Number)
  @IsLatitude({ message: "Latitude must be between -90 and 90." })
  latitude!: number;

  @Type(() => Number)
  @IsLongitude({ message: "Longitude must be between -180 and 180." })
  longitude!: number;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1000)
  name?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(1000)
  address?: string;
}
