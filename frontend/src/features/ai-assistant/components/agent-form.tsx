"use client";

import * as React from "react";
import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { ApiError, updateAgent } from "../api";
import type { Agent } from "../types";

const FIELD =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-[13.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";

const CAPS = [500, 900, 1_200, 1_600];

/**
 * The agent's settings: what it is called, what it handles, and how a reply is
 * length-capped or handed on. There is no model to choose — answering is local.
 *
 * A save sends every field at once — the DTO is all-optional, and a partial
 * send would make "unchanged" and "cleared" indistinguishable.
 *
 * Only an OWNER can save; everybody else reads the same fields locked. The
 * guard in `save()` matters as much as the disabled inputs, because a form
 * without a submit button still submits on Enter.
 */
export function AgentForm({
  agent,
  canManage,
  readOnlyNote,
  onSaved,
}: {
  agent: Agent;
  canManage: boolean;
  /** Why it is read-only, when the caller knows better than this form does. */
  readOnlyNote?: string;
  onSaved: (next: Agent) => void;
}) {
  const toast = useToast();

  const [name, setName] = React.useState(agent.name);
  const [description, setDescription] = React.useState(agent.description ?? "");
  const [maxReplyChars, setMaxReplyChars] = React.useState(agent.maxReplyChars);
  const [keywords, setKeywords] = React.useState(
    agent.escalateKeywords.join(", "),
  );
  const [saving, setSaving] = React.useState(false);

  const payload = React.useMemo(
    () => ({
      name: name.trim(),
      description: description.trim(),
      maxReplyChars,
      escalateKeywords: keywords
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .slice(0, 20),
    }),
    [name, description, maxReplyChars, keywords],
  );

  /** Nothing typed, or typed back to what is stored. */
  const dirty =
    payload.name !== agent.name ||
    payload.description !== (agent.description ?? "") ||
    payload.maxReplyChars !== agent.maxReplyChars ||
    payload.escalateKeywords.join(",") !== agent.escalateKeywords.join(",");

  const blocked = payload.name.length === 0;

  /** A save in flight, or no right to save at all. */
  const locked = saving || !canManage;

  async function save() {
    if (locked || !dirty || blocked) return;

    setSaving(true);

    try {
      const next = await updateAgent(agent.id, payload);
      onSaved(next.agent);
      toast.push({
        title: "Saved",
        description: "The next reply uses these settings.",
        tone: "success",
      });
    } catch (caught) {
      toast.push({
        title: "Could not save",
        description:
          caught instanceof ApiError
            ? caught.message
            : "The agent could not be updated.",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="agent-name">Name</Label>
          <input
            className={cn(FIELD, "mt-1.5")}
            disabled={locked}
            id="agent-name"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="Front desk"
            spellCheck={false}
            value={name}
          />
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            Shown in the Inbox beside a reply. Customers never see it.
          </p>
        </div>

        <div>
          <Label htmlFor="agent-description">Description</Label>
          <input
            className={cn(FIELD, "mt-1.5")}
            disabled={locked}
            id="agent-description"
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Answers prices, hours and delivery questions"
            value={description}
          />
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            For your team. Also helps route a question to the right agent.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="agent-cap">Longest reply</Label>
          <select
            className={cn(FIELD, "mt-1.5 max-w-[16rem]")}
            disabled={locked}
            id="agent-cap"
            onChange={(event) => setMaxReplyChars(Number(event.target.value))}
            value={maxReplyChars}
          >
            {CAPS.map((cap) => (
              <option key={cap} value={cap}>
                {cap.toLocaleString()} characters
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            A reply that runs longer is cut at the last full sentence.
          </p>
        </div>

        <div>
          <Label htmlFor="agent-keywords">Escalate on these words</Label>
          <input
            className={cn(FIELD, "mt-1.5")}
            disabled={locked}
            id="agent-keywords"
            onChange={(event) => setKeywords(event.target.value)}
            placeholder="refund, complaint, lawyer"
            spellCheck={false}
            value={keywords}
          />
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Comma separated. A match hands the thread to a person without asking
            anything else, which is what keeps a complaint out of an automatic
            reply.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-[11.5px] text-muted-foreground">
          {!canManage
            ? (readOnlyNote ??
              "Read-only. Only an owner can change how this agent answers.")
            : blocked
              ? "A name is required."
              : dirty
                ? "Unsaved changes."
                : "All changes saved."}
        </p>
        {canManage ? (
          <Button
            disabled={!dirty || blocked || saving}
            type="submit"
            variant="brand"
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
        ) : null}
      </div>
    </form>
  );
}
