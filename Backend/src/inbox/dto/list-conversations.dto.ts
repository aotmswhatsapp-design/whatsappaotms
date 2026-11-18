import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

/**
 * Filters for the queue. All optional: the shell's first call sends nothing and
 * gets the newest threads.
 *
 * `assignee` is a user id, `me`, or `unassigned` — the three choices the list's
 * dropdown offers.
 */
export class ListConversationsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(["OPEN", "PENDING", "CLOSED"])
  status?: "OPEN" | "PENDING" | "CLOSED";

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignee?: string;

  /** A bounded page: the list is a queue, not an archive. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
