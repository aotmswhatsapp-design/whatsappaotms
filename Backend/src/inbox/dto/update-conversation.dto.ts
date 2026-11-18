import { IsIn, IsOptional, IsUUID } from "class-validator";

/**
 * Either field may be sent alone. An explicit `assignedToUserId: null` clears
 * the assignment, which is why `@IsOptional` (not `@IsDefined`) is used.
 */
export class UpdateConversationDto {
  @IsOptional()
  @IsIn(["OPEN", "PENDING", "CLOSED"])
  status?: "OPEN" | "PENDING" | "CLOSED";

  @IsOptional()
  @IsUUID(undefined, { message: "Assignment must name a workspace member." })
  assignedToUserId?: string | null;
}
