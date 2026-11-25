"use client";

import * as React from "react";
import { Check, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import {
  ApiError,
  addRecipients,
  createCampaign,
  fetchAudience,
  updateCampaign,
  type Audience,
  type AudienceSource,
  type Campaign,
  type CampaignOptions,
  type RecipientImportReport,
  type RecipientRow,
  type TokenBinding,
} from "../api";
import { normalisePhone, type DraftRecipient } from "../recipients";
import { CampaignPreview } from "./campaign-preview";
import { RecipientEditor } from "./recipient-editor";

/** Typing a tag is not a reason to query; settling on one is. */
const AUDIENCE_DELAY_MS = 350;

/**
 * The create and edit panel.
 *
 * A campaign is one approved template sent once to a segment, so the form
 * collects exactly that: which template, who, how each `{{token}}` is filled,
 * and when. Every rule it enforces is the server's rule, restated so the
 * button explains itself before the request is made.
 *
 * Editing keeps the template: a campaign is one template sent once, and
 * changing it would be a new campaign wearing the old one's counts.
 */
export function CampaignForm({
  options,
  editing,
  onClose,
  onSaved,
}: {
  options: CampaignOptions;
  /** Present when a draft is being changed rather than created. */
  editing?: Campaign;
  onClose: () => void;
  onSaved: (campaign: Campaign, recipients?: RecipientImportReport) => void;
}) {
  const [name, setName] = React.useState(editing?.name ?? "");
  const [templateId, setTemplateId] = React.useState(editing?.template.id ?? "");
  const [audienceSource, setAudienceSource] = React.useState<AudienceSource>(
    editing?.audienceSource ?? "LIST",
  );
  const [recipients, setRecipients] = React.useState<DraftRecipient[]>([]);
  const [tags, setTags] = React.useState<string[]>(editing?.audienceTags ?? []);
  const [bindings, setBindings] = React.useState<Record<string, TokenBinding>>(
    editing?.variables ?? {},
  );
  const [buttonUrls, setButtonUrls] = React.useState<Record<string, string>>(
    editing?.buttonUrls ?? {},
  );
  const [schedule, setSchedule] = React.useState(
    editing?.scheduledAt ? scheduleValue(editing.scheduledAt) : "",
  );
  const [optIn, setOptIn] = React.useState(editing?.optInConfirmed ?? false);
  const [query, setQuery] = React.useState("");
  const [audience, setAudience] = React.useState<Audience | null>(null);
  const [audienceLoading, setAudienceLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const template =
    options.templates.find((entry) => entry.id === templateId) ?? null;
  const shape = template?.shape ?? null;
  const marketing = template?.category === "MARKETING";

  // The audience is measured on the server, never from a client count: the
  // number on screen has to be the list that will be sent to.
  const tagKey = tags.join("\u0000");

  React.useEffect(() => {
    // A list campaign is measured from its own rows, so the tag segment is not
    // even asked for.
    if (audienceSource !== "SEGMENT") return;

    let active = true;
    const requested = tagKey ? tagKey.split("\u0000") : [];
    const timer = setTimeout(() => {
      setAudienceLoading(true);

      fetchAudience(requested)
        .then((next) => {
          if (active) setAudience(next);
        })
        .catch(() => {
          if (active) setAudience(null);
        })
        .finally(() => {
          if (active) setAudienceLoading(false);
        });
    }, AUDIENCE_DELAY_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [tagKey, audienceSource]);

  function chooseTemplate(id: string) {
    const next = options.templates.find((entry) => entry.id === id);

    setTemplateId(id);
    setButtonUrls({});

    // A new template asks for different tokens, so the old answers would be
    // values for questions nobody asked.
    setBindings(
      Object.fromEntries(
        (next?.shape.tokens ?? []).map((token) => [
          token,
          { kind: "static", value: "" } satisfies TokenBinding,
        ]),
      ),
    );
  }

  function toggleTag(tag: string) {
    setTags((current) =>
      current.includes(tag)
        ? current.filter((entry) => entry !== tag)
        : [...current, tag],
    );
  }

  // A list campaign is measured from its own rows, so the tag count is not in
  // the answer: the numbers on screen are the ones that will be sent to.
  const listTotal =
    (editing?.audienceSource === "LIST" ? editing.counts.total : 0) +
    recipients.length;

  // Numbers already saved on this campaign are its audience; sending by tag
  // instead would run twice over the same people, so the switch is refused.
  const hasNumbers =
    editing?.audienceSource === "LIST" && editing.counts.total > 0;

  const problems = problemsInForm({
    name,
    template,
    shape,
    bindings,
    buttonUrls,
    marketing,
    optIn,
    audienceSource,
    listTotal,
    schedule,
  });

  const sample =
    audienceSource === "LIST"
      ? sampleOf(recipients[0])
      : (audience?.sample[0] ?? null);
  const needle = query.trim().toLowerCase();
  const templates = options.templates.filter(
    (entry) =>
      needle.length === 0 ||
      entry.name.toLowerCase().includes(needle) ||
      entry.category.toLowerCase().includes(needle),
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!template || problems.length > 0) return;

    setSubmitting(true);
    setError(null);

    try {
      const draft = {
        name: name.trim(),
        audienceSource,
        audienceTags: audienceSource === "SEGMENT" ? tags : [],
        variables: bindings,
        buttonUrls,
        optInConfirmed: optIn,
        scheduledAt: schedule ? new Date(schedule).toISOString() : null,
      };

      if (editing) {
        const saved = await updateCampaign(editing.id, draft);

        // The numbers are added after the campaign is saved: they are their
        // own rows, and the import reports what it had to drop.
        if (audienceSource === "LIST" && recipients.length > 0) {
          const added = await addRecipients(editing.id, rowsOf(recipients));

          onSaved(added.campaign, added.recipients);
          return;
        }

        onSaved(saved.campaign);
        return;
      }

      const created = await createCampaign({
        ...draft,
        templateId: template.id,
        ...(audienceSource === "LIST" ? { recipients: rowsOf(recipients) } : {}),
      });

      onSaved(created.campaign, created.recipients);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The campaign could not be saved.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full sm:max-w-xl" side="right">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{editing ? "Edit campaign" : "New campaign"}</SheetTitle>
          <SheetDescription>
            {editing
              ? "Only a draft or a scheduled campaign can change. The template stays the one Meta approved for this send."
              : "One approved template, sent to a segment through the connected number."}
          </SheetDescription>
        </SheetHeader>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-4">
            <section className="space-y-1.5">
              <Label htmlFor="campaign-name">Name</Label>
              <input
                className={FIELD}
                id="campaign-name"
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                placeholder="Diwali offer"
                spellCheck={false}
                value={name}
              />
              <p className="text-[11.5px] text-muted-foreground">
                Only your team sees this. It is not part of the message.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold text-foreground">
                Template
              </h3>

              {editing ? (
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  The template cannot change once the campaign exists: these
                  counts belong to the message Meta approved for this send.
                </p>
              ) : null}

              {options.templates.length > 6 ? (
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    aria-label="Search approved templates"
                    className={cn(FIELD, "pl-9")}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search by name or category"
                    spellCheck={false}
                    type="search"
                    value={query}
                  />
                </div>
              ) : null}

              <div
                aria-label="Approved templates"
                className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-card p-2"
                role="group"
              >
                {templates.length === 0 ? (
                  <p className="px-1.5 py-2 text-[12.5px] text-muted-foreground">
                    No approved template matches that search.
                  </p>
                ) : (
                  templates.map((entry) => {
                    const chosen = entry.id === templateId;

                    return (
                      <button
                        aria-pressed={chosen}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
                          chosen
                            ? "bg-secondary text-foreground"
                            : "text-foreground hover:bg-secondary/60",
                        )}
                        disabled={Boolean(editing)}
                        key={entry.id}
                        onClick={() => chooseTemplate(entry.id)}
                        type="button"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">
                            {entry.name}
                          </span>
                          <span className="block truncate text-[11.5px] text-muted-foreground">
                            {entry.category.toLowerCase()} · {entry.language}
                            {entry.shape.tokens.length > 0
                              ? ` · ${entry.shape.tokens.length} value${entry.shape.tokens.length === 1 ? "" : "s"}`
                              : " · no values"}
                          </span>
                        </span>
                        {chosen ? (
                          <Check className="size-4 shrink-0 text-brand" />
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold text-foreground">
                Audience
              </h3>

              <div className="grid gap-1.5 sm:grid-cols-2">
                <SourceOption
                  active={audienceSource === "LIST"}
                  detail="Numbers you add here, or import from an Excel sheet or CSV."
                  onClick={() => setAudienceSource("LIST")}
                  title="Recipient list"
                />
                <SourceOption
                  active={audienceSource === "SEGMENT"}
                  // Those rows are the audience it sends to, so the switch is
                  // refused until they are removed on the campaign page.
                  detail={
                    hasNumbers
                      ? "Remove this campaign's numbers on its page before sending by tag."
                      : "Every contact carrying the tags below, counted when it sends."
                  }
                  disabled={hasNumbers}
                  onClick={() => setAudienceSource("SEGMENT")}
                  title="Contact tags"
                />
              </div>

              {audienceSource === "LIST" ? (
                <div className="space-y-2 pt-1">
                  {editing && editing.counts.total > 0 ? (
                    <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                      This campaign already has {editing.counts.total} number
                      {editing.counts.total === 1 ? "" : "s"}. Numbers added
                      here are saved when the form is saved, and duplicates are
                      removed for you.
                    </p>
                  ) : (
                    <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                      A row each: name, email, phone with the country code, and
                      an identity of your own. Only the phone number is needed
                      to send — two rows with the same number are kept once.
                    </p>
                  )}

                  <RecipientEditor
                    onChange={setRecipients}
                    rows={recipients}
                  />
                </div>
              ) : (
                <div className="space-y-2 pt-1">
                  <div className="flex flex-wrap gap-1.5">
                    <TagChip
                      active={tags.length === 0}
                      label="Everyone"
                      onClick={() => setTags([])}
                    />
                    {options.tags.map((tag) => (
                      <TagChip
                        active={tags.includes(tag)}
                        key={tag}
                        label={tag}
                        onClick={() => toggleTag(tag)}
                      />
                    ))}
                  </div>

                  <p
                    aria-live="polite"
                    className="text-[12.5px] leading-relaxed text-muted-foreground"
                  >
                    {audienceLoading && !audience ? (
                      "Counting the contacts this reaches…"
                    ) : audience ? (
                      <>
                        <span className="font-medium text-foreground">
                          {audience.total} contact{audience.total === 1 ? "" : "s"}
                        </span>{" "}
                        {tags.length === 0
                          ? "— every contact in this workspace."
                          : `tagged ${tags.join(", ")}.`}
                        {sample
                          ? ` First: ${sample.profileName ?? sample.phoneDisplay ?? sample.waId}.`
                          : ""}
                      </>
                    ) : (
                      "The audience could not be counted. The campaign still sends to whatever matches when it starts."
                    )}
                  </p>
                </div>
              )}
            </section>

            {shape && shape.tokens.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold text-foreground">
                  Values
                </h3>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  A value is either the same text for everyone or read from each
                  recipient. A name always needs a fallback, because Meta
                  refuses an empty parameter.
                </p>

                <div className="space-y-2">
                  {shape.tokens.map((token) => (
                    <TokenRow
                      binding={
                        bindings[token] ?? { kind: "static", value: "" }
                      }
                      key={token}
                      onChange={(next) =>
                        setBindings((current) => ({
                          ...current,
                          [token]: next,
                        }))
                      }
                      token={token}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {shape && shape.urlButtons.some((button) => button.hasVariable) ? (
              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold text-foreground">
                  Button links
                </h3>

                {shape.urlButtons
                  .filter((button) => button.hasVariable)
                  .map((button) => (
                    <div className="space-y-1" key={button.index}>
                      <Label htmlFor={`campaign-url-${button.index}`}>
                        {button.text ?? "Open link"} — {button.url}
                      </Label>
                      <input
                        className={FIELD}
                        id={`campaign-url-${button.index}`}
                        onChange={(event) =>
                          setButtonUrls((current) => ({
                            ...current,
                            [String(button.index)]: event.target.value,
                          }))
                        }
                        placeholder="https://example.com/offer"
                        spellCheck={false}
                        value={buttonUrls[String(button.index)] ?? ""}
                      />
                    </div>
                  ))}
              </section>
            ) : null}

            <section className="space-y-1.5">
              <Label htmlFor="campaign-schedule">Schedule</Label>
              <input
                className={cn(FIELD, "w-auto")}
                id="campaign-schedule"
                onChange={(event) => setSchedule(event.target.value)}
                type="datetime-local"
                value={schedule}
              />
              <p className="text-[11.5px] text-muted-foreground">
                Optional. An empty schedule saves a draft you can start by hand.
                A campaign sends in the order of the contacts, at the pace the
                server sets.
              </p>
            </section>

            {marketing ? (
              <section className="rounded-lg border border-warning/45 bg-warning/10 px-3 py-2.5">
                <label className="flex items-start gap-2 text-[12.5px] leading-relaxed text-foreground">
                  <input
                    checked={optIn}
                    className="mt-0.5 size-4 accent-[var(--brand)]"
                    onChange={(event) => setOptIn(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    These contacts agreed to receive marketing messages. Meta
                    requires opt-in for a marketing template and can restrict
                    the number when recipients report it.
                  </span>
                </label>
              </section>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold text-foreground">
                Preview
              </h3>
              {shape ? (
                <CampaignPreview
                  bindings={bindings}
                  buttonUrls={buttonUrls}
                  sample={
                    sample
                      ? {
                          name: sample.profileName,
                          waId: sample.waId,
                        }
                      : null
                  }
                  shape={shape}
                />
              ) : (
                <p className="text-[12.5px] text-muted-foreground">
                  Choose a template to preview the message.
                </p>
              )}
            </section>
          </div>

          <SheetFooter className="border-t border-border">
            {error ? (
              <p
                className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12.5px] leading-relaxed text-foreground"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button onClick={onClose} type="button" variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={submitting || problems.length > 0}
                type="submit"
                variant="brand"
              >
                {submitting ? <Loader2 className="animate-spin" /> : null}
                {editing
                  ? "Save changes"
                  : schedule
                    ? "Schedule campaign"
                    : "Save draft"}
              </Button>
            </div>

            {problems.length > 0 ? (
              <p className="text-right text-[11.5px] leading-relaxed text-muted-foreground">
                {problems[0]}
              </p>
            ) : null}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function TagChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
        active
          ? "border-brand/45 bg-brand-soft text-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function TokenRow({
  token,
  binding,
  onChange,
}: {
  token: string;
  binding: TokenBinding;
  onChange: (next: TokenBinding) => void;
}) {
  const fromContact = binding.kind === "contact";

  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="rounded bg-secondary px-1.5 py-0.5 text-[12px] font-medium text-foreground">
          {`{{${token}}}`}
        </code>

        <div
          aria-label={`How ${`{{${token}}}`} is filled`}
          className="flex rounded-md border border-border p-0.5"
          role="group"
        >
          <ModeButton
            active={!fromContact}
            label="Same for all"
            onClick={() => onChange({ kind: "static", value: "" })}
          />
          <ModeButton
            active={fromContact}
            label="From contact"
            onClick={() =>
              onChange({ kind: "contact", field: "name", fallback: "" })
            }
          />
        </div>
      </div>

      {binding.kind === "static" ? (
        <input
          aria-label={`Text for ${`{{${token}}}`}`}
          className={cn(FIELD, "mt-2")}
          onChange={(event) =>
            onChange({ kind: "static", value: event.target.value })
          }
          placeholder="The text every recipient reads"
          value={binding.value}
        />
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            <select
              aria-label={`Contact field for ${`{{${token}}}`}`}
              className={cn(FIELD, "w-auto")}
              onChange={(event) =>
                onChange({
                  ...binding,
                  field: event.target.value === "waId" ? "waId" : "name",
                })
              }
              value={binding.field}
            >
              <option value="name">Contact name</option>
              <option value="waId">WhatsApp number</option>
            </select>

            {binding.field === "name" ? (
              <input
                aria-label={`Fallback name for ${`{{${token}}}`}`}
                className={cn(FIELD, "min-w-40 flex-1")}
                onChange={(event) =>
                  onChange({ ...binding, fallback: event.target.value })
                }
                placeholder="Used when a contact has no saved name"
                value={binding.fallback ?? ""}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "rounded px-2 py-1 text-[11.5px] font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
        active
          ? "bg-secondary text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

const FIELD =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-[13.5px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";

/** One of the two audiences a campaign can have. They exclude each other. */
function SourceOption({
  title,
  detail,
  active,
  disabled = false,
  onClick,
}: {
  title: string;
  detail: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
        active
          ? "border-brand/45 bg-brand-soft"
          : "border-border bg-card hover:bg-secondary/50",
        disabled && "cursor-not-allowed opacity-60 hover:bg-card",
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
        {title}
        {active ? <Check className="size-3.5 text-brand" /> : null}
      </span>
      <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
        {detail}
      </span>
    </button>
  );
}

/** A staged row, described the way the audience count describes a contact. */
function sampleOf(
  row?: DraftRecipient,
): { profileName: string | null; waId: string; phoneDisplay: string | null } | null {
  if (!row) return null;

  const waId = normalisePhone(row.phone);

  if (!waId) return null;

  return {
    profileName: row.name.trim() || null,
    waId,
    phoneDisplay: row.phone.trim() || null,
  };
}

/** The staged rows, in the shape the endpoint reads. */
function rowsOf(rows: DraftRecipient[]): RecipientRow[] {
  return rows.map((row) => ({
    phone: row.phone,
    name: row.name.trim() || undefined,
    email: row.email.trim() || undefined,
    identity: row.identity.trim() || undefined,
  }));
}

/** An ISO instant as `datetime-local` wants it: local, to the minute. */
function scheduleValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The server's rules, restated. The list is also the button's explanation: the
 * first sentence is what to fix next, so a disabled button is never silent.
 */
function problemsInForm({
  name,
  template,
  shape,
  bindings,
  buttonUrls,
  marketing,
  optIn,
  audienceSource,
  listTotal,
  schedule,
}: {
  name: string;
  template: { category: string } | null;
  shape: { tokens: string[]; urlButtons: { index: number; url: string; hasVariable: boolean }[] } | null;
  bindings: Record<string, TokenBinding>;
  buttonUrls: Record<string, string>;
  marketing: boolean;
  optIn: boolean;
  audienceSource: AudienceSource;
  listTotal: number;
  /** `datetime-local` text, empty when the campaign is saved as a draft. */
  schedule: string;
}): string[] {
  const problems: string[] = [];

  if (!name.trim()) problems.push("Give the campaign a name.");
  if (!template) problems.push("Choose an approved template.");

  // A list campaign sends to its rows and to nobody else, so an empty list has
  // nobody to send to.
  if (audienceSource === "LIST" && listTotal === 0) {
    problems.push("Add at least one number to the audience.");
  }

  for (const token of shape?.tokens ?? []) {
    const binding = bindings[token];

    if (!binding) {
      problems.push(`Fill in {{${token}}}.`);
    } else if (binding.kind === "static") {
      if (!binding.value.trim()) problems.push(`Fill in {{${token}}}.`);
    } else if (binding.field === "name" && !(binding.fallback ?? "").trim()) {
      problems.push(`Give {{${token}}} a fallback for contacts with no name.`);
    }
  }

  for (const button of shape?.urlButtons ?? []) {
    if (!button.hasVariable) continue;

    const address = buttonUrls[String(button.index)]?.trim() ?? "";

    if (!address) {
      problems.push(`Fill in the link for the “${button.url}” button.`);
    } else if (!/^https?:\/\//i.test(address)) {
      problems.push("A button link needs to start with http:// or https://.");
    }
  }

  if (marketing && !optIn) {
    problems.push("Confirm that these contacts agreed to marketing messages.");
  }

  // The server refuses a schedule that is not in the future, and it is the
  // server that answers 400. Checking here keeps a doomed payload from being
  // sent: a time picked a minute ago is a draft, not an error.
  if (schedule) {
    const at = new Date(schedule);

    if (Number.isNaN(at.getTime())) {
      problems.push("Give the schedule a valid date and time.");
    } else if (at.getTime() <= Date.now()) {
      problems.push("A schedule has to be in the future.");
    }
  }

  return problems;
}
