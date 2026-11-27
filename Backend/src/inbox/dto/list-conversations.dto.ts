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

  /** One stage, when the queue is being read as a lead list. */
  @IsOptional()
  @IsIn(["UNKNOWN", "INTERESTED", "NOT_INTERESTED"])
  interest?: "UNKNOWN" | "INTERESTED" | "NOT_INTERESTED";

  /**
   * The menu's fourth stage, "Follow-up": a stage the row does not store,
   * because it is the pair of an interested lead and the task still owed on
   * it. A filter of its own keeps the three-value `interest` contract intact.
   */
  @IsOptional()
  @IsIn(["open"])
  followUp?: "open";

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignee?: string;

  /**
   * One number's threads, when the workspace has more than one. Absent means
   * every number, which is the only answer a single-number workspace needs.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountId?: string;

  /** A bounded page: the list is a queue, not an archive. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
