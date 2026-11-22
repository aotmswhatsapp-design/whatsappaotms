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
  TemplateButtonType,
  TemplateCategoryName,
} from "../templates.payload";

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/**
 * Length and shape limits live in `templates.payload.ts`, because they are the
 * same numbers the builder counts against and a second copy would drift. The
 * decorators here only guarantee the request has the shape the builder expects.
 */
export const TEMPLATE_CATEGORIES: TemplateCategoryName[] = [
  "AUTHENTICATION",
  "MARKETING",
  "UTILITY",
];

export const PARAMETER_FORMATS: ParameterFormatName[] = ["NAMED", "POSITIONAL"];

const HEADER_FORMATS: HeaderFormatName[] = ["TEXT", "IMAGE"];

const BUTTON_TYPES: TemplateButtonType[] = [
  "QUICK_REPLY",
  "URL",
  "PHONE_NUMBER",
  "COPY_CODE",
];

export class TemplateButtonDto {
  @IsIn(BUTTON_TYPES, { message: "Unknown button type." })
  type!: TemplateButtonType;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  text?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  url?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  urlExample?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  codeExample?: string;
}

export class CreateTemplateDto {
  @Transform(trimmed)
  @IsString()
  name!: string;

  @IsIn(TEMPLATE_CATEGORIES, {
    message: "A template is authentication, marketing or utility.",
  })
  category!: TemplateCategoryName;

  /**
   * Meta's own language code, e.g. `en_US`. Not enumerated here: the supported
   * list changes, and Meta's refusal names the offending code, which is a better
   * error than a stale local table rejecting a code that just became valid.
   */
  @Transform(trimmed)
  @IsString()
  language!: string;

  @IsIn(PARAMETER_FORMATS, { message: "Parameters are named or positional." })
  parameterFormat!: ParameterFormatName;

  /** Omitted means a text header, so an older client is unaffected. */
  @IsOptional()
  @IsIn(HEADER_FORMATS, { message: "A header is text or an image." })
  headerFormat?: HeaderFormatName;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  header?: string;

  /** The path POST /v1/templates/media answered, required for IMAGE headers. */
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
