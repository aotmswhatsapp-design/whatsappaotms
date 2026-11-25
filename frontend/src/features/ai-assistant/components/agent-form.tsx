"use client";

import * as React from "react";
import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { ApiError, updateAgent } from "../api";
import { AGENT_MODELS, type Agent, type AgentModel } from "../types";

const FIELD =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-[13.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";

/** Tall enough to edit a real briefing without scrolling on a laptop. */
const AREA = cn(
  FIELD,
  "min-h-[240px] resize-y py-2.5 leading-relaxed",
);

const PROMPT_PLACEHOLDER = `You are the assistant for {business}. Answer only from the reference material you are given.

- Reply in the customer's language, in plain WhatsApp text: no headings, no markdown tables.
- One short paragraph, then a line about what happens next.
- Quote a price only when the material states it. Otherwise say you will confirm.
- Never promise a delivery date the material does not state.
- If the question is not covered, or the customer is upset, say a person will reply shortly.`;

const CAPS = [500, 900, 1_200, 1_600];

/** Where the form lands when the stored model is not one the DTO accepts. */
const FALLBACK_MODEL: AgentModel = "gpt-5.4-mini";

/**
 * `Agent.model` is a plain string on the wire — the union is enforced on write,
 * not on read — so this narrows it back before the value is sent again.
 */
function asModel(value: string): AgentModel {
  return (
    AGENT_MODELS.find((entry) => entry.value === value)?.value ?? FALLBACK_MODEL
  );
}

/**
 * The Prompt tab: everything that shapes an answer before any material is read.
 *
 * The instructions field is the product, so it is the largest element on the
 * tab and the only one with standing rules in its placeholder. A save sends
 * every field at once — the DTO is all-optional, and a partial send would make
 * "unchanged" and "cleared" indistinguishable.
 */
export function AgentForm({
  agent,
  onSaved,
}: {
  agent: Agent;
  onSaved: (next: Agent) => void;
}) {
  const toast = useToast();

  const [name, setName] = React.useState(agent.name);
  const [description, setDescription] = React.useState(agent.description ?? "");
  const [prompt, setPrompt] = React.useState(agent.systemPrompt);
  const [model, setModel] = React.useState<AgentModel>(() => asModel(agent.model));
  const [temperature, setTemperature] = React.useState(agent.temperature);
  const [maxReplyChars, setMaxReplyChars] = React.useState(agent.maxReplyChars);
  const [keywords, setKeywords] = React.useState(
    agent.escalateKeywords.join(", "),
  );
  const [saving, setSaving] = React.useState(false);

  const payload = React.useMemo(
    () => ({
      name: name.trim(),
      description: description.trim(),
      systemPrompt: prompt.trim(),
      model,
      temperature,
      maxReplyChars,
      escalateKeywords: keywords
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .slice(0, 20),
    }),
    [name, description, prompt, model, temperature, maxReplyChars, keywords],
  );

  /** Nothing typed, or typed back to what is stored. */
  const dirty =
    payload.name !== agent.name ||
    payload.description !== (agent.description ?? "") ||
    payload.systemPrompt !== agent.systemPrompt ||
    payload.model !== agent.model ||
    payload.temperature !== agent.temperature ||
    payload.maxReplyChars !== agent.maxReplyChars ||
    payload.escalateKeywords.join(",") !== agent.escalateKeywords.join(",");

  const blocked =
    payload.name.length === 0 ||
    payload.systemPrompt.length === 0 ||
    payload.systemPrompt.length > 8_000;

  async function save() {
    if (saving || !dirty || blocked) return;

    setSaving(true);

    try {
      const next = await updateAgent(agent.id, payload);
      onSaved(next.agent);
      toast.push({
        title: "Saved",
        description: "The next reply uses these instructions.",
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
            disabled={saving}
            id="agent-name"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="Front desk"
            spellCheck={false}
            value={name}
          />
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            Shown in the Inbox beside an AI reply. Customers never see it.
          </p>
        </div>

        <div>
          <Label htmlFor="agent-description">Description</Label>
          <input
            className={cn(FIELD, "mt-1.5")}
            disabled={saving}
            id="agent-description"
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Answers prices, hours and delivery questions"
            value={description}
          />
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            For your team. Not sent to the model.
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-end justify-between gap-3">
          <Label htmlFor="agent-prompt">Instructions</Label>
          <span className="text-[11.5px] tabular-nums text-muted-foreground">
            {prompt.length.toLocaleString()} / 8,000
          </span>
        </div>
        <textarea
          className={cn(AREA, "mt-1.5")}
          disabled={saving}
          id="agent-prompt"
          maxLength={8_000}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={PROMPT_PLACEHOLDER}
          spellCheck={false}
          value={prompt}
        />
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          The reference material is appended to this at reply time, and the
          customer&apos;s message always arrives as a separate turn — so nothing
          a customer writes can rewrite these rules.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="agent-model">Model</Label>
          <select
            className={cn(FIELD, "mt-1.5")}
            disabled={saving}
            id="agent-model"
            onChange={(event) => setModel(asModel(event.target.value))}
            value={model}
          >
            {AGENT_MODELS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {AGENT_MODELS.find((entry) => entry.value === model)?.blurb ?? ""}
          </p>
        </div>

        <div>
          <div className="flex items-end justify-between gap-3">
            <Label htmlFor="agent-temperature">Temperature</Label>
            <span className="text-[11.5px] tabular-nums text-muted-foreground">
              {temperature.toFixed(1)}
            </span>
          </div>
          <input
            className="mt-3 w-full accent-[var(--brand)]"
            disabled={saving}
            id="agent-temperature"
            max={1.2}
            min={0}
            onChange={(event) => setTemperature(Number(event.target.value))}
            step={0.1}
            type="range"
            value={temperature}
          />
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Lower repeats the material more literally. Above 1.0 the reply starts
            to invent wording.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="agent-cap">Longest reply</Label>
          <select
            className={cn(FIELD, "mt-1.5")}
            disabled={saving}
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
            disabled={saving}
            id="agent-keywords"
            onChange={(event) => setKeywords(event.target.value)}
            placeholder="refund, complaint, lawyer"
            spellCheck={false}
            value={keywords}
          />
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Comma separated. A match hands the thread to a person without asking
            the model, which is what keeps a complaint out of an AI reply.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-[11.5px] text-muted-foreground">
          {blocked
            ? "A name and instructions are required."
            : dirty
              ? "Unsaved changes."
              : "All changes saved."}
        </p>
        <Button
          disabled={!dirty || blocked || saving}
          type="submit"
          variant="brand"
        >
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          Save prompt
        </Button>
      </div>
    </form>
  );
}
