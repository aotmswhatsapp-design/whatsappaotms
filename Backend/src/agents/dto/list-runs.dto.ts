import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

import type { AgentRunKind, AgentRunStatus } from "@prisma/client";

const KINDS: AgentRunKind[] = ["REPLY", "PLAYGROUND"];
const STATUSES: AgentRunStatus[] = ["QUEUED", "CLAIMED", "SENT", "SKIPPED", "FAILED"];

export class ListRunsDto {
  @IsOptional()
  @IsIn(KINDS)
  kind?: AgentRunKind;

  @IsOptional()
  @IsIn(STATUSES)
  status?: AgentRunStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}
