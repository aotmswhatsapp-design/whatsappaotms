import { Transform } from "class-transformer";
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/**
 * The two roles an invitation may grant.
 *
 * Ownership is deliberately absent: a workspace has one owner, and handing it
 * over is not something a link should be able to do. `ADMIN` is the PRD's
 * Manager, `AGENT` its Support Agent.
 */
export const TEAM_ROLES = ["ADMIN", "AGENT"] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

export class InviteMemberDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: "Enter the email address to invite." })
  @MaxLength(254)
  email!: string;

  @IsIn(TEAM_ROLES)
  role!: TeamRole;
}

export class ChangeMemberRoleDto {
  @IsIn(TEAM_ROLES)
  role!: TeamRole;
}

export class AcceptInvitationDto {
  @Transform(trim)
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;
}
