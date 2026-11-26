import { Transform } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsObject,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/**
 * The roles an invitation may grant, in the order the PRD describes them.
 *
 * Ownership is deliberately absent: a workspace has one owner, and handing it
 * over is not something a link should be able to do. `ADMIN` runs the product
 * but not the WhatsApp connection, `MANAGER` is the PRD's Manager, and `AGENT`
 * its Support Agent.
 */
export const TEAM_ROLES = ["ADMIN", "MANAGER", "AGENT"] as const;

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

/**
 * One role's module list per key: `{ roles: { AGENT: ["inbox"] } }`.
 *
 * The shape is checked here and the module keys are checked in the service,
 * which is where the registry lives — a decorator cannot enumerate a list that
 * is allowed to grow between releases.
 */
export class SetRolePermissionsDto {
  @IsObject()
  roles!: Record<string, unknown>;
}
