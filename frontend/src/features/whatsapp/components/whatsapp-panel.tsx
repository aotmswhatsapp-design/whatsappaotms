"use client";

import { Lock, Phone, ShieldCheck } from "lucide-react";

import { StatusDot, type StatusDotTone } from "@/components/ui/status-dot";
import { useWhatsAppStatus } from "@/hooks/use-whatsapp-status";
import type { AccessRole } from "@/lib/access/api";
import { WhatsAppConnection } from "./whatsapp-connection";

/**
 * The WhatsApp screen, decided by role.
 *
 * The number belongs to the workspace, not to whoever happens to be signed
 * in: an invited member works the owner's number and is never asked to bring
 * one of their own. So the owner gets the wizard, and everybody else gets the
 * read-only status — the same facts the sidebar dot reads, and nothing that
 * could overwrite the credentials.
 *
 * The role arrives from the page, read on the server, rather than from the
 * client's access cache: that cache belongs to the tab, and a tab that changed
 * hands can still hold the previous person's answer. Because the branch is
 * taken before anything is serialised, a member's page never carries the
 * connect wizard at all — there is nothing to mount and then hide. `null`
 * means the role could not be confirmed, and the safe answer for an
 * unconfirmed caller is the read-only card.
 */
export function WhatsAppPanel({ role }: { role: AccessRole | null }) {
  if (role === "OWNER") return <WhatsAppConnection />;

  return <WhatsAppStatusReadOnly role={role} />;
}

/**
 * What an Admin, Manager or Agent sees: the connected number and whether Meta
 * is delivering, with one line saying who can change it. No form, no Embedded
 * Signup, no disconnect button — those routes answer 403 for this role, so
 * offering them would be a dead control.
 */
function WhatsAppStatusReadOnly({ role }: { role: AccessRole | null }) {
  const status = useWhatsAppStatus();
  const number = status.number;

  const tone: StatusDotTone =
    status.state === "live"
      ? "live"
      : status.state === "error"
        ? "error"
        : "pending";

  const headline =
    status.state === "none"
      ? "No number connected yet"
      : status.state === "live"
        ? "Connected and receiving"
        : status.state === "pending"
          ? "Saved — waiting for Meta to confirm"
          : "Meta rejected the stored credentials";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
              <Phone className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">
                {number?.display ?? "The workspace's WhatsApp number"}
              </h2>
              <p className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
                {status.state === "none" ? null : (
                  <StatusDot label={headline} tone={tone} />
                )}
                {headline}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <Lock className="size-3" aria-hidden="true" />
            Managed by the owner
          </span>
        </div>

        {status.state === "error" && status.reason ? (
          <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {status.reason}
          </p>
        ) : null}

        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              Verified name
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {number?.verifiedName ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              Business account
            </dt>
            <dd className="mt-1 truncate font-mono text-sm text-foreground">
              {number?.businessAccountId ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              Number ID
            </dt>
            <dd className="mt-1 truncate font-mono text-sm text-foreground">
              {number?.phoneNumberId ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              Delivery
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {number?.receiving
                ? "Meta events are arriving"
                : "Not receiving events"}
            </dd>
          </div>
        </dl>

        <p className="mt-5 flex items-start gap-2 text-[13px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Everyone in the workspace answers from this same number. Connecting,
          re-verifying or disconnecting it is the owner&apos;s alone — ask them
          if the status looks wrong.
        </p>
      </section>

      <p className="text-[13px] text-muted-foreground">
        {role
          ? `You are signed in as ${roleLabel(role)}. Your access to this screen is a workspace setting the owner can change.`
          : "Only the workspace owner can change this connection. Reload if you are the owner and this looks wrong."}
      </p>
    </div>
  );
}

function roleLabel(role: AccessRole): string {
  if (role === "ADMIN") return "an admin";
  if (role === "MANAGER") return "a manager";
  if (role === "AGENT") return "a support agent";

  return "a member";
}
