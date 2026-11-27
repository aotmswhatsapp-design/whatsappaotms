import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

export const INTEREST_VALUES = ["UNKNOWN", "INTERESTED", "NOT_INTERESTED"] as const;
export const TASK_STATUSES = ["OPEN", "DONE", "CANCELLED"] as const;
export const TASK_SCOPES = ["mine", "all"] as const;

export type InterestValue = (typeof INTEREST_VALUES)[number];
export type TaskStatusValue = (typeof TASK_STATUSES)[number];

/** A manager's decision about one lead. */
export class SetInterestDto {
  @IsIn(INTEREST_VALUES)
  interest!: InterestValue;
}

export class UpdateTaskDto {
  // `IsOptional` also skips null, and a null status is not a column Prisma can
  // store: only an absent field means "leave it alone".
  @ValidateIf((_dto, value) => value !== undefined)
  @IsIn(TASK_STATUSES)
  status?: TaskStatusValue;

  /** ISO-8601, or null to clear the deadline. */
  @IsOptional()
  @IsISO8601()
  dueAt?: string | null;
}

export class ListTasksDto {
  @IsOptional()
  @IsIn(TASK_SCOPES)
  scope?: "mine" | "all";
}

export class CrmSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  leadDesignation?: string | null;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsBoolean()
  autoAssign?: boolean;

  @ValidateIf((_dto, value) => value !== undefined)
  @IsBoolean()
  autoTask?: boolean;

  @ValidateIf((_dto, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  taskDueHours?: number;
}
