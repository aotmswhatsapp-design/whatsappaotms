"use client";

import * as React from "react";
import {
  Check,
  Copy,
  LoaderCircle,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast, type ToastOptions } from "@/components/ui/toast";
import { DataTable } from "@/components/workspace/data-table";
import { EmptyState } from "@/components/workspace/empty-state";
import { cn } from "@/lib/utils";

import {
  ApiError,
  changeMemberRole,
  fetchTeam,
  inviteMember,
  inviteUrl,
  removeMember,
  revokeInvitation,
  ROLE_HINTS,
  ROLE_LABELS,
  type Invitation,
  type Member,
  type MemberRole,
  type TeamWorkspace,
} from "../api";

const FIELD =
  "mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-[13.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";

const SELECT =
  "h-8 rounded-md border border-input bg-background px-2 text-[12.5px] font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60";

const MEMBER_COLUMNS = [
  { key: "member", label: "Member" },
  { key: "role", label: "Role" },
  { key: "access", label: "Access", className: "text-right" },
];

const INVITE_COLUMNS = [
  { key: "email", label: "Address" },
  { key: "role", label: "Role" },
  { key: "sent", label: "Sent" },
  { key: "expires", label: "Expires" },
  { key: "action", label: "Link", className: "text-right" },
];

/**
 * Who is on this workspace and who may join it.
 *
 * Everything is read through the API rather than rendered from the session:
 * the list, the roles and the pending links all live on the server, and a
 * member sees the same screen the owner does minus the controls. The invitation
 * token is the one thing that cannot be re-read — it exists in this component's
 * state for as long as the panel stays open, then nowhere.
 */
export function TeamView({ viewerId }: { viewerId: string }) {
  const toast = useToast();

  const [workspace, setWorkspace] = React.useState<TeamWorkspace | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;

    fetchTeam()
      .then((next) => {
        if (!active) return;
        setWorkspace(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(
          caught instanceof ApiError ? caught.message : "The team could not be read.",
        );
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  if (!workspace) {
    return error ? (
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-sm font-semibold text-foreground">
          The team could not be read
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {error}
        </p>
        <Button className="mt-4" onClick={() => setAttempt((n) => n + 1)} size="sm">
          Try again
        </Button>
      </div>
    ) : (
      <div
        aria-hidden="true"
        className="h-56 animate-pulse rounded-xl border border-border bg-card"
      />
    );
  }

  const canManage = workspace.role === "OWNER";

  function addInvitation(invitation: Invitation) {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            // Re-inviting the same address replaces the pending row on the
            // server under a new id, so the old one has to go by address.
            invitations: [
              invitation,
              ...current.invitations.filter(
                (row) => row.id !== invitation.id && row.email !== invitation.email,
              ),
            ],
          }
        : current,
    );
  }

  function replaceMember(member: Member) {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            members: current.members.map((row) =>
              row.userId === member.userId ? member : row,
            ),
          }
        : current,
    );
  }

  function dropMember(userId: string) {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            members: current.members.filter((row) => row.userId !== userId),
          }
        : current,
    );
  }

  function dropInvitation(id: string) {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            invitations: current.invitations.filter((row) => row.id !== id),
          }
        : current,
    );
  }

  return (
    <div className="space-y-6">
      {canManage ? (
        <InviteCard onCreated={addInvitation} />
      ) : (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
          You are on this team as {ROLE_LABELS[workspace.role]}. The workspace
          owner invites people, changes roles and removes access.
        </p>
      )}

      <MembersTable
        canManage={canManage}
        members={workspace.members}
        onMemberChanged={replaceMember}
        onMemberRemoved={dropMember}
        onToast={toast.push}
        viewerId={viewerId}
      />

      {canManage ? (
        <InvitationsTable
          invitations={workspace.invitations}
          onRemoved={dropInvitation}
          onToast={toast.push}
        />
      ) : null}
    </div>
  );
}

/**
 * The invite form and the one-time link it produced.
 *
 * No mailer exists in this deployment, so the link is handed to the owner to
 * pass on. It stays on screen until dismissed, because it cannot be printed
 * again — only its hash reaches the database.
 */
function InviteCard({
  onCreated,
}: {
  onCreated: (invitation: Invitation) => void;
}) {
  const toast = useToast();

  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<MemberRole>("AGENT");
  const [pending, setPending] = React.useState(false);
  const [granted, setGranted] = React.useState<{
    email: string;
    url: string;
  } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const address = email.trim();
    if (!address || pending) return;

    setPending(true);

    try {
      const { invitation, token } = await inviteMember({ email: address, role });

      setGranted({ email: invitation.email, url: inviteUrl(token) });
      setEmail("");
      onCreated(invitation);

      toast.push({
        tone: "success",
        title: "Invitation created",
        description: `A one-week link for ${invitation.email} is ready below.`,
      });
    } catch (caught) {
      toast.push({
        tone: "error",
        title: "Could not create the invitation",
        description:
          caught instanceof ApiError ? caught.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="rounded-xl border border-border bg-card p-5"
      onSubmit={submit}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
          <UserPlus className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            Invite a teammate
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            We create a one-week link for you to pass on; nothing is emailed.
            The person joins by signing in with exactly the address you type
            here.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
        <div>
          <Label htmlFor="invite-email">Email address</Label>
          <input
            autoComplete="email"
            className={FIELD}
            id="invite-email"
            maxLength={254}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="teammate@company.com"
            required
            type="email"
            value={email}
          />
        </div>

        <div>
          <Label htmlFor="invite-role">Role</Label>
          <select
            className={cn(SELECT, "mt-1.5 h-9 w-full")}
            id="invite-role"
            onChange={(event) => setRole(event.target.value as MemberRole)}
            value={role}
          >
            <option value="AGENT">{ROLE_LABELS.AGENT}</option>
            <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
          </select>
        </div>

        <Button disabled={pending || email.trim().length === 0} type="submit">
          {pending ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus aria-hidden="true" />
          )}
          Create link
        </Button>
      </div>

      <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
        {ROLE_HINTS[role]}
      </p>

      {granted ? (
        <div className="mt-4 rounded-lg border border-brand/30 bg-brand-soft/60 p-3.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[12.5px] font-semibold text-foreground">
              Send this link to {granted.email}
            </p>
            <button
              aria-label="Dismiss the invitation link"
              className="-mt-1 -mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setGranted(null)}
              type="button"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>

          <LinkField label="Invitation link" url={granted.url} />

          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
            This is the only time the link is shown — the database keeps only
            its hash. Inviting the same address again replaces it and stops this
            one working.
          </p>
        </div>
      ) : null}
    </form>
  );
}

function MembersTable({
  canManage,
  members,
  viewerId,
  onMemberChanged,
  onMemberRemoved,
  onToast,
}: {
  canManage: boolean;
  members: Member[];
  viewerId: string;
  onMemberChanged: (member: Member) => void;
  onMemberRemoved: (userId: string) => void;
  onToast: (options: ToastOptions) => void;
}) {
  const [armed, setArmed] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function setRole(member: Member, role: MemberRole) {
    if (role === member.role) return;

    setBusy(member.userId);

    try {
      const { member: updated } = await changeMemberRole(member.userId, role);
      onMemberChanged(updated);
      onToast({
        tone: "success",
        title: "Role updated",
        description: `${updated.name ?? updated.email} is now ${ROLE_LABELS[updated.role]}.`,
      });
    } catch (caught) {
      onToast({
        tone: "error",
        title: "Could not change the role",
        description:
          caught instanceof ApiError ? caught.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setBusy(null);
    }
  }

  async function remove(member: Member) {
    setBusy(member.userId);

    try {
      await removeMember(member.userId);
      setArmed(null);
      onMemberRemoved(member.userId);
      onToast({
        tone: "success",
        title: "Access removed",
        description: `${member.name ?? member.email} can no longer open this workspace. History stays.`,
      });
    } catch (caught) {
      onToast({
        tone: "error",
        title: "Could not remove them",
        description:
          caught instanceof ApiError ? caught.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setBusy(null);
    }
  }

  const rows = members.map((member) => [
    <div className="min-w-0" key="who">
      <p className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
        {member.name ?? member.email}
        {member.userId === viewerId ? (
          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
            You
          </span>
        ) : null}
      </p>
      {member.name ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{member.email}</p>
      ) : null}
    </div>,

    member.owner || !canManage ? (
      <RoleChip key="role" role={member.role} />
    ) : (
      <select
        aria-label={`Role for ${member.name ?? member.email}`}
        className={SELECT}
        disabled={busy === member.userId}
        key="role"
        onChange={(event) => setRole(member, event.target.value as MemberRole)}
        value={member.role}
      >
        <option value="AGENT">{ROLE_LABELS.AGENT}</option>
        <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
      </select>
    ),

    <div className="flex justify-end" key="access">
      {member.owner ? (
        <span className="text-xs text-muted-foreground">Cannot be removed</span>
      ) : !canManage ? (
        <span className="text-xs text-muted-foreground">—</span>
      ) : armed === member.userId ? (
        <span className="flex items-center gap-1">
          <Button
            disabled={busy === member.userId}
            onClick={() => remove(member)}
            size="sm"
            variant="destructive"
          >
            {busy === member.userId ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
            Remove
          </Button>
          <Button
            disabled={busy === member.userId}
            onClick={() => setArmed(null)}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
        </span>
      ) : (
        <Button
          onClick={() => setArmed(member.userId)}
          size="sm"
          variant="ghost"
        >
          <Trash2 aria-hidden="true" />
          Remove
        </Button>
      )}
    </div>,
  ]);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Members</h2>
        <span className="text-xs text-muted-foreground">
          {members.length} {members.length === 1 ? "person" : "people"}
        </span>
      </div>

      <DataTable
        columns={MEMBER_COLUMNS}
        empty={
          <EmptyState
            className="border-0 bg-transparent py-10"
            description="Nobody has joined this workspace yet."
            icon={Users}
            title="No members"
          />
        }
        rows={rows}
      />
    </section>
  );
}

function InvitationsTable({
  invitations,
  onRemoved,
  onToast,
}: {
  invitations: Invitation[];
  onRemoved: (id: string) => void;
  onToast: (options: ToastOptions) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);

  async function revoke(invitation: Invitation) {
    setBusy(invitation.id);

    try {
      await revokeInvitation(invitation.id);
      onRemoved(invitation.id);
      onToast({
        tone: "info",
        title: "Invitation withdrawn",
        description: `The link for ${invitation.email} stopped working.`,
      });
    } catch (caught) {
      onToast({
        tone: "error",
        title: "Could not withdraw it",
        description:
          caught instanceof ApiError ? caught.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setBusy(null);
    }
  }

  const rows = invitations.map((invitation) => [
    <span key="email" className="font-medium text-foreground">
      {invitation.email}
    </span>,
    <RoleChip key="role" role={invitation.role} />,
    <span key="sent" className="text-xs text-muted-foreground">
      {day(invitation.createdAt)}
    </span>,
    <span key="expires" className="text-xs text-muted-foreground">
      {expiry(invitation.expiresAt)}
    </span>,
    <div className="flex justify-end" key="action">
      <Button
        disabled={busy === invitation.id}
        onClick={() => revoke(invitation)}
        size="sm"
        variant="ghost"
      >
        {busy === invitation.id ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <X aria-hidden="true" />
        )}
        Revoke
      </Button>
    </div>,
  ]);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          Pending invitations
        </h2>
        <span className="text-xs text-muted-foreground">
          {invitations.length === 0
            ? "None"
            : `${invitations.length} waiting`}
        </span>
      </div>

      <DataTable
        columns={INVITE_COLUMNS}
        empty={
          <EmptyState
            className="border-0 bg-transparent py-10"
            description="A link you create above appears here until it is used, withdrawn or expires."
            icon={UserPlus}
            title="No invitations waiting"
          />
        }
        rows={rows}
      />
    </section>
  );
}

function RoleChip({ role }: { role: Member["role"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        role === "OWNER"
          ? "bg-brand-soft text-brand"
          : "bg-secondary text-muted-foreground",
      )}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

/** A link that exists to be pasted somewhere else, and never silently fails. */
function LinkField({ label, url }: { label: string; url: string }) {
  const toast = useToast();
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      toast.push({
        tone: "error",
        title: "Could not copy",
        description: "Select the link and copy it by hand.",
        duration: 6_000,
      });
    }
  }

  return (
    <div className="mt-2">
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-card px-3 py-2 font-mono text-[12.5px] text-foreground">
          {url}
        </code>
        <button
          aria-label={`Copy ${label.toLowerCase()}`}
          className={cn(
            "grid w-10 shrink-0 place-items-center rounded-lg border border-border bg-card text-foreground transition-colors",
            "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40",
          )}
          onClick={copy}
          type="button"
        >
          {copied ? (
            <Check className="size-4 text-lime" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <p aria-live="polite" className="mt-1 text-[12px] text-lime">
        {copied ? "Copied to the clipboard." : ""}
      </p>
    </div>
  );
}

/** A bare date: when the invitation was created. */
function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** How long the link still has: days, not a timestamp nobody translates. */
function expiry(iso: string): string {
  const left = new Date(iso).getTime() - Date.now();
  if (left <= 0) return "Expired";

  const days = Math.ceil(left / 86_400_000);
  return days === 1 ? "in 1 day" : `in ${days} days`;
}
