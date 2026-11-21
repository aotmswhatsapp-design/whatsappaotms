"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import {
  ApiError,
  fetchBusinessProfile,
  saveBusinessProfile,
  type BusinessProfile,
  type BusinessProfileInput,
} from "./api";

/**
 * The four stored fields, in the order the form shows them.
 *
 * `kind` separates the timezone, which is not free text: a typo here shifts
 * every scheduled send by a silent number of hours, and nothing downstream can
 * tell that "Asia/Kolkatta" was meant. The select is built from the browser's
 * own list of the zones it can actually resolve.
 */
const FIELDS = [
  {
    kind: "text",
    name: "companyName",
    label: "Company name",
    placeholder: "Your company",
    maxLength: 120,
    hint: "Printed on invoices and internal screens.",
  },
  {
    kind: "text",
    name: "website",
    label: "Website",
    placeholder: "https://example.com",
    maxLength: 2048,
    hint: "Full address, including https://.",
  },
  {
    kind: "timezone",
    name: "timezone",
    label: "Timezone",
  },
  {
    kind: "text",
    name: "supportNumber",
    label: "Support number",
    placeholder: "+91 90000 12345",
    maxLength: 32,
    hint: "Where your team answers, if it is not the WhatsApp number itself.",
  },
] as const;

const EMPTY: BusinessProfileInput = {
  companyName: "",
  website: "",
  timezone: "Asia/Kolkata",
  supportNumber: "",
};

/**
 * The workspace's own details — the ones our screens use, as opposed to the
 * profile customers see on WhatsApp, which is owned by Meta and shown above.
 *
 * The save button is never disabled for lack of changes: a save that writes the
 * values already stored is harmless, and a dead button is the thing the
 * WhatsApp form was rebuilt to avoid.
 */
export function BusinessProfileForm({ accountEmail }: { accountEmail: string }) {
  const toast = useToast();
  const [form, setForm] = React.useState<BusinessProfileInput>(EMPTY);
  const [saved, setSaved] = React.useState<BusinessProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    fetchBusinessProfile()
      .then((next) => {
        if (!active) return;
        setSaved(next);
        setForm(toInput(next));
        setLoadError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setLoadError(readError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function change(name: keyof BusinessProfileInput, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  // Saving without a successful read would post the blanks this form started
  // with over whatever is already stored, so an unread row blocks the save.
  const unread = loadError !== null && saved === null;
  const blocked = loading || unread;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked) return;
    setSaving(true);
    setSaveError(null);

    try {
      const next = await saveBusinessProfile(form);
      setSaved(next);
      setForm(toInput(next));
      toast.push({
        tone: "success",
        title: "Profile saved",
        description: "Scheduled sends will use this timezone from the next run.",
      });
    } catch (caught: unknown) {
      // Kept on the form rather than only in a toast: a validation message is
      // read next to the field it indicts, and a toast disappears.
      setSaveError(readError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="rounded-xl border border-border bg-card p-5" onSubmit={onSubmit}>
      <h2 className="text-base font-semibold text-foreground">Workspace details</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        Used by your own automations and invoices. Customers never see these.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">
            Account email
          </span>
          <input
            readOnly
            className="mt-1.5 h-9 w-full rounded-lg border border-border bg-secondary/60 px-3 text-sm text-foreground outline-none"
            name="accountEmail"
            type="email"
            value={accountEmail}
          />
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Set by your sign-in account, so it is not editable here.
          </span>
        </label>

        {FIELDS.map((field) =>
          field.kind === "timezone" ? (
            <label key={field.name} className="block">
              <span className="text-xs font-medium text-muted-foreground">
                {field.label}
              </span>
              <TimezoneSelect
                disabled={loading}
                onChange={(next) => change(field.name, next)}
                value={form.timezone}
              />
              <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                The IANA id, with the offset it is on right now. Scheduled
                sends follow it through daylight saving.
              </span>
            </label>
          ) : (
            <label key={field.name} className="block">
              <span className="text-xs font-medium text-muted-foreground">
                {field.label}
              </span>
              <input
                className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-ring/30"
                disabled={loading}
                maxLength={field.maxLength}
                name={field.name}
                onChange={(event) => change(field.name, event.target.value)}
                placeholder={field.placeholder}
                type="text"
                value={form[field.name]}
              />
              <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                {field.hint}
              </span>
            </label>
          ),
        )}
      </div>

      {loadError ? (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-background px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
          {loadError}
        </p>
      ) : null}

      {saveError ? (
        <p
          className="mt-4 rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12.5px] leading-relaxed text-foreground"
          role="alert"
        >
          {saveError}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button disabled={saving || blocked} type="submit" variant="brand">
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          {loading
            ? "Reading the saved details…"
            : unread
              ? "Saving is blocked until the stored values can be read, so nothing is overwritten."
              : saved?.updatedAt
                ? `Last saved ${stamp(saved.updatedAt)}.`
                : "Nothing is saved yet."}
        </p>
      </div>
    </form>
  );
}

/**
 * Used only by engines that lack `Intl.supportedValuesOf`. Deliberately short:
 * the point is that a customer on an old browser still gets a working select,
 * not that this list is complete.
 */
const FALLBACK_ZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Kathmandu",
  "Asia/Colombo",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Jakarta",
  "Asia/Manila",
  "Asia/Bangkok",
  "Asia/Ho_Chi_Minh",
  "Asia/Jerusalem",
  "Europe/Istanbul",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Zurich",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Mexico_City",
  "America/Bogota",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "Australia/Perth",
  "Pacific/Auckland",
];

/** Built once per page: ~400 zones is not something to re-render per keystroke. */
let cachedZoneRows: { value: string; label: string }[] | null = null;

/**
 * Every zone this browser can resolve, labelled `Asia/Kolkata — GMT+5:30` so
 * the id and what it currently means are both on screen. A stored value the
 * browser's list omits is kept at the top rather than dropped: a select whose
 * value is not among its options renders blank and would silently post that.
 */
function zoneRows(stored: string): { value: string; label: string }[] {
  const rows = (cachedZoneRows ??= buildZoneRows());

  if (!stored || rows.some((row) => row.value === stored)) return rows;

  // `supportedValuesOf` returns canonical ids only, so a perfectly valid alias
  // like `Asia/Kolkata` (`Asia/Calcutta` is the canonical one) is missing from
  // it. Resolving the stored value is what separates an alias, which just needs
  // its offset, from a value no engine has ever heard of.
  const offset = offsetOf(stored);

  return [
    {
      value: stored,
      label: offset
        ? `${stored} — ${offset}`
        : `${stored} — not a timezone this browser knows`,
    },
    ...rows,
  ];
}

function buildZoneRows(): { value: string; label: string }[] {
  const ids = readZoneIds();

  return ids.map((zone) => {
    const offset = offsetOf(zone);
    return { value: zone, label: offset ? `${zone} — ${offset}` : zone };
  });
}

/**
 * The list is built after hydration, never during render.
 *
 * Two reasons, both observed: the offset labels come from the runtime's own
 * ICU data (Node writes `GMT`, the browser writes `GMT+0`, so the option text
 * hydrates mismatched), and reading `new Date()` in a client component that is
 * also prerendered trips Next's unstable-value check under `cacheComponents`.
 * Until the list exists the field holds just the stored value, so the control
 * is never blank.
 */
function TimezoneSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const [rows, setRows] = React.useState<
    { value: string; label: string }[] | null
  >(null);

  React.useEffect(() => {
    let active = true;

    // Deferred a turn so it is not a synchronous cascading update from an
    // effect; `zoneRows` remembers its base list, so only the merge is redone.
    Promise.resolve().then(() => {
      if (active) setRows(zoneRows(value));
    });

    return () => {
      active = false;
    };
  }, [value]);

  const options = rows ?? [{ value, label: value }];

  return (
    <select
      className="mt-1.5 h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-ring/30"
      disabled={disabled}
      name="timezone"
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      {options.map((row) => (
        <option key={row.value} value={row.value}>
          {row.label}
        </option>
      ))}
    </select>
  );
}

function readZoneIds(): string[] {
  // Typed by hand because `Intl.supportedValuesOf` is newer than the lib this
  // project compiles against; the optional call is what makes it safe anyway.
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: "timeZone") => string[] }
  ).supportedValuesOf?.("timeZone");

  const zones = supported && supported.length > 0 ? supported : FALLBACK_ZONES;

  // The spec leaves UTC out of that list even though every browser resolves it.
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

function offsetOf(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());

    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function toInput(profile: BusinessProfile): BusinessProfileInput {
  return {
    companyName: profile.companyName ?? "",
    website: profile.website ?? "",
    timezone: profile.timezone,
    supportNumber: profile.supportNumber ?? "",
  };
}

function readError(caught: unknown): string {
  return caught instanceof ApiError
    ? caught.message
    : "The request failed. Check the API is running and try again.";
}

/**
 * Absolute, not relative: this only renders after the browser has the row, so
 * there is no server/client split to disagree about.
 */
function stamp(iso: string): string {
  const at = new Date(iso);

  if (Number.isNaN(at.getTime())) return "just now";

  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
