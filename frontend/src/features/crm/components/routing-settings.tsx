"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";

import { ApiError, saveCrmSettings, type CrmSettings } from "../api";

const FIELD =
  "mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-[13.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";

/**
 * Who gets a new lead, and what they owe when they do.
 *
 * The designation is set per person on the Team screen; this card only chooses
 * which designation receives a lead. With exactly one designation on the
 * roster the choice is forced, and the line under the picker says so — a
 * control whose value the server overrides has to explain itself.
 */
export function RoutingSettings({
  settings,
  onSaved,
}: {
  settings: CrmSettings;
  onSaved: (next: CrmSettings) => void;
}) {
  const toast = useToast();
  const [designation, setDesignation] = React.useState(settings.leadDesignation ?? "");
  const [autoAssign, setAutoAssign] = React.useState(settings.autoAssign);
  const [autoTask, setAutoTask] = React.useState(settings.autoTask);
  const [dueHours, setDueHours] = React.useState(String(settings.taskDueHours));
  const [busy, setBusy] = React.useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const hours = Number(dueHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
      toast.push({
        tone: "error",
        title: "Due hours must be a whole number from 1 to 720",
        duration: 0,
      });
      return;
    }

    setBusy(true);

    try {
      const next = await saveCrmSettings({
        leadDesignation: designation || null,
        autoAssign,
        autoTask,
        taskDueHours: hours,
      });

      onSaved(next);
      setDesignation(next.leadDesignation ?? "");
      toast.push({ tone: "success", title: "Lead routing saved" });
    } catch (caught) {
      toast.push({
        tone: "error",
        title: "Could not save the routing",
        description:
          caught instanceof ApiError ? caught.message : "The request failed.",
        duration: 0,
      });
    } finally {
      setBusy(false);
    }
  }

  const noRoster = settings.designations.length === 0;

  return (
    <form
      className="max-w-xl space-y-4 rounded-xl border border-border bg-card p-4"
      onSubmit={(event) => void save(event)}
    >
      <div>
        <Label htmlFor="lead-designation">New leads go to</Label>
        <select
          className={FIELD}
          disabled={noRoster || busy}
          id="lead-designation"
          onChange={(event) => setDesignation(event.target.value)}
          value={designation}
        >
          <option value="">Choose a designation</option>
          {settings.designations.map((row) => (
            <option key={row} value={row}>
              {row}
            </option>
          ))}
        </select>

        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
          {noRoster
            ? "Nobody on the roster has a designation yet. Set one for each person on Team & permissions, then come back."
            : settings.effectiveDesignation
              ? `Leads currently rotate to: ${settings.effectiveDesignation}.`
              : "Nothing rotates until a designation is chosen and someone on the roster carries it."}
        </p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="auto-assign">Assign the conversation</Label>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            The lead is handed to the next person in rotation, so it appears in
            their inbox the moment it becomes interested.
          </p>
        </div>
        <Switch
          checked={autoAssign}
          disabled={busy}
          id="auto-assign"
          onCheckedChange={setAutoAssign}
        />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="auto-task">Open a follow-up task</Label>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Every interested lead gets a task with a deadline, so nobody has to
            remember it.
          </p>
        </div>
        <Switch
          checked={autoTask}
          disabled={busy}
          id="auto-task"
          onCheckedChange={setAutoTask}
        />
      </div>

      <div>
        <Label htmlFor="due-hours">Close the follow-up within</Label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            className="h-9 w-24 rounded-lg border border-input bg-background px-3 text-[13.5px] text-foreground tabular-nums shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]"
            disabled={busy}
            id="due-hours"
            inputMode="numeric"
            max={720}
            min={1}
            onChange={(event) => setDueHours(event.target.value)}
            type="number"
            value={dueHours}
          />
          <span className="text-[12.5px] text-muted-foreground">hours</span>
        </div>
      </div>

      <Button disabled={busy} size="sm" type="submit">
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Save routing
      </Button>
    </form>
  );
}
