"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

import { acceptInvitation, ApiError, fetchTeam } from "../api";

type State =
  | { kind: "joining" }
  | { kind: "joined"; joined: boolean; elsewhere: boolean }
  | { kind: "failed"; message: string };

/**
 * Accepts the link on arrival: the invitation is the intent, so a second
 * "Join" button would only ask the visitor to confirm what clicking already
 * said.
 *
 * The accept call is sent once per mount — the API marks the invitation used,
 * so a duplicate would report a link that has just worked as invalid.
 */
export function JoinView({ token }: { token: string }) {
  const [state, setState] = React.useState<State>({ kind: "joining" });
  const [attempt, setAttempt] = React.useState(0);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;

    let active = true;

    acceptInvitation(token)
      .then(async (result) => {
        // An account that has opened the app before already owns a workspace,
        // and `primaryFor` pins to the oldest membership — so joining is not
        // the same as landing there. Read back which one the app will open and
        // say so rather than let the attempt look like it failed.
        const team = await fetchTeam().catch(() => null);

        if (!active) return;

        setState({
          kind: "joined",
          joined: result.joined,
          elsewhere: team !== null && team.id !== result.workspaceId,
        });
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setState({
          kind: "failed",
          message:
            caught instanceof ApiError
              ? caught.message
              : "The invitation could not be accepted.",
        });
      });

    return () => {
      active = false;
    };
  }, [token, attempt]);

  if (state.kind === "joining") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-5">
        <LoaderCircle
          aria-hidden="true"
          className="size-5 shrink-0 animate-spin text-brand"
        />
        <div>
          <p className="text-sm font-semibold text-foreground">
            Joining the team…
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Checking the invitation against your signed-in address.
          </p>
        </div>
      </div>
    );
  }

  if (state.kind === "failed") {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
            <CircleAlert aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">
              This invitation could not be used
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {state.message}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              An invitation only works for the address it was sent to, so sign
              in with that address and open the link again.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={() => {
              started.current = false;
              setState({ kind: "joining" });
              setAttempt((n) => n + 1);
            }}
            variant="outline"
          >
            Try again
          </Button>
          <Button asChild variant="ghost">
            <Link href="/workspace">Open my workspace</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-lime-soft text-lime">
          <CircleCheck aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            {state.joined ? "You are on the team" : "You were already on the team"}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {state.joined
              ? "The workspace is shared with your account now. Conversations assigned to you, campaigns and the inbox are all in the sidebar."
              : "This invitation had already been accepted, so nothing changed. Your role is the one the owner set."}
          </p>
        </div>
      </div>

      {state.elsewhere ? (
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[13px] leading-relaxed text-foreground">
          You joined, but this account already belongs to a workspace of its
          own, and the app opens the oldest one. There is no workspace switcher
          yet, so the team you just joined may not be the one you land in.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/workspace/inbox">
            Open the inbox
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/workspace/team">See the team</Link>
        </Button>
      </div>
    </div>
  );
}
