import { Transform } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/**
 * The roles an invitation may grant, in the order the PRD describes them.
 *
 * Ownership is deliberately absent: a link is answered by whoever holds it, so
 * a forwarded one must never be able to make its holder an owner. Ownership is
 * granted from the team screen instead, to somebody the owner already knows.
 * `ADMIN` runs the product but not the WhatsApp connection, `MANAGER` is the
 * PRD's Manager, and `AGENT` its Support Agent.
 */
export const TEAM_ROLES = ["ADMIN", "MANAGER", "AGENT"] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

/** What an owner may set on somebody already on the team, ownership included:
 *  a second owner is how the workspace keeps running while the first is away. */
export const ASSIGNABLE_ROLES = ["OWNER", ...TEAM_ROLES] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

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
  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;
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

/**
 * A personal number in the shape the `wa.me` link needs: digits only, country
 * code first, no `+`. An empty field means "clear it", which is how the owner
 * undoes a typo without another route.
 */
export function phoneDigits(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const digits = value.replace(/[\s+()-]/g, "");
  return digits.length === 0 ? null : digits;
}

/**
 * What the owner may change on a member. Email is deliberately absent: it is
 * the Supabase auth identity, and changing it here would lock the member out
 * until they verified the new address.
 */
export class UpdateMemberProfileDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  fullName?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(40)
  designation?: string | null;

  @IsOptional()
  @Transform(({ value }) => phoneDigits(value))
  @Matches(/^\d{8,15}$/, {
    message: "Enter the number with its country code, digits only.",
  })
  personalWhatsApp?: string | null;
}
