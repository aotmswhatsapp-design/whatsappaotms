import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

import type {
  HeaderFormatName,
  ParameterFormatName,
  TemplateCategoryName,
} from "../templates.payload";
import {
  HEADER_FORMATS,
  PARAMETER_FORMATS,
  TEMPLATE_CATEGORIES,
  TemplateButtonDto,
} from "./create-template.dto";

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/**
 * An edit, not a creation: Meta keys a template on name plus language, and it
 * refuses a call that tries to change `parameter_format` after creation. Those
 * three are therefore absent here — the service fills them from the stored row,
 * so a client cannot rename an approved template by accident.
 *
 * `body` is required because Meta replaces `components` wholesale: a call that
 * omitted the body would delete it.
 */
export class UpdateTemplateDto {
  @IsOptional()
  @IsIn(TEMPLATE_CATEGORIES, {
    message: "A template is authentication, marketing or utility.",
  })
  category?: TemplateCategoryName;

  /**
   * Accepted only to be rejected with a sentence: Meta cannot switch a
   * template between named and positional parameters, and saying so here is
   * clearer than a generic Graph error.
   */
  @IsOptional()
  @IsIn(PARAMETER_FORMATS, { message: "Parameters are named or positional." })
  parameterFormat?: ParameterFormatName;

  /** Omitted means a text header, so a client that forgets it drops the image. */
  @IsOptional()
  @IsIn(HEADER_FORMATS, { message: "A header is text or an image." })
  headerFormat?: HeaderFormatName;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  header?: string;

  /** A new sample from POST /v1/templates/media; omitted keeps the stored one. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  mediaPath?: string;

  @Transform(trimmed)
  @IsString()
  body!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  footer?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateButtonDto)
  buttons?: TemplateButtonDto[];

  /** Variable token (no braces) → example value. */
  @IsOptional()
  @IsObject()
  examples?: Record<string, string>;
}
