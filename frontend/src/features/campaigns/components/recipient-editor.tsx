"use client";

import * as React from "react";
import {
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SpreadsheetError } from "@/lib/spreadsheet/read";
import { cn } from "@/lib/utils";

import {
  normalisePhone,
  readRecipientFile,
  recipientTemplate,
  type DraftRecipient,
  type ImportReport,
} from "../recipients";

const FIELD =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-[13px] text-foreground shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";

/** Rows drawn at once. Past this the list is a wall, and the count is the sum. */
const VISIBLE_ROWS = 50;

const EMPTY_ROW: DraftRecipient = { name: "", email: "", phone: "", identity: "" };

/**
 * The number list of a campaign, while it can still change.
 *
 * Rows are added one at a time or in bulk from a spreadsheet, and nothing is
 * sent from here: the caller owns `rows` and decides when they become
 * recipients — with the campaign itself, or with an Add press on a campaign
 * that already exists.
 *
 * Duplicates are the point of the panel as much as the rows are. Every number
 * that repeats, in the file or against the campaign, is dropped as it arrives
 * and counted on screen, so nobody discovers a double send after it happened.
 */
export function RecipientEditor({
  rows,
  onChange,
  known,
  action,
  disabled = false,
}: {
  rows: DraftRecipient[];
  onChange: (next: DraftRecipient[]) => void;
  /** Numbers the campaign already has, so a re-import adds nothing twice. */
  known?: Set<string>;
  /** The panel's own submit, used when the list is saved on its own. */
  action?: { label: string; busy?: boolean; disabled?: boolean; onClick: () => void };
  disabled?: boolean;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [manual, setManual] = React.useState(false);
  const [draft, setDraft] = React.useState<DraftRecipient>(EMPTY_ROW);
  const [report, setReport] = React.useState<ImportReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reading, setReading] = React.useState(false);

  const staged = React.useMemo(() => {
    const numbers = new Set(known ?? []);

    for (const row of rows) {
      const waId = normalisePhone(row.phone);

      if (waId) numbers.add(waId);
    }

    return numbers;
  }, [known, rows]);

  function addManual(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const phone = draft.phone.trim();

    if (phone.length === 0) {
      setError("A row needs a phone number.");
      return;
    }

    const waId = normalisePhone(phone);

    if (!waId) {
      setError(
        "That number cannot be sent to. Write it in digits with the country code, for example 919876543210.",
      );
      return;
    }

    if (staged.has(waId)) {
      setError(`${phone} is already in this list, so it was not added twice.`);
      return;
    }

    setError(null);
    setReport(null);
    onChange([
      ...rows,
      { name: draft.name.trim(), email: draft.email.trim(), phone, identity: draft.identity.trim() },
    ]);
    // The form stays open: a list is usually typed in one sitting.
    setDraft(EMPTY_ROW);
  }

  async function importFile(file: File) {
    setReading(true);
    setError(null);

    try {
      const parsed = await readRecipientFile(file, staged);

      setReport(parsed);
      onChange([...rows, ...parsed.rows]);
    } catch (caught) {
      setReport(null);
      setError(
        caught instanceof SpreadsheetError
          ? caught.message
          : "That file could not be read. Save it as .xlsx or .csv and try again.",
      );
    } finally {
      setReading(false);
    }
  }

  function remove(index: number) {
    onChange(rows.filter((_, at) => at !== index));
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          accept=".xlsx,.xlsm,.csv,.txt"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];

            // Cleared so picking the same file again still fires a change.
            event.target.value = "";

            if (file) void importFile(file);
          }}
          ref={fileRef}
          type="file"
        />

        <Button
          disabled={disabled || reading}
          onClick={() => setManual((open) => !open)}
          size="sm"
          type="button"
          variant={manual ? "secondary" : "outline"}
        >
          {manual ? <X /> : <Plus />}
          {manual ? "Close" : "Add a row"}
        </Button>

        <Button
          disabled={disabled || reading}
          onClick={() => fileRef.current?.click()}
          size="sm"
          type="button"
          variant="outline"
        >
          {reading ? <Loader2 className="animate-spin" /> : <Upload />}
          Import Excel or CSV
        </Button>

        <Button
          onClick={download}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Download />
          Template
        </Button>

        <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
          {rows.length} number{rows.length === 1 ? "" : "s"} ready
        </span>
      </div>

      {manual ? (
        <form
          className="space-y-2 rounded-lg border border-border bg-card p-2.5"
          onSubmit={addManual}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Field
              id="recipient-name"
              label="Name"
              onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
              placeholder="Ravi Kumar"
              value={draft.name}
            />
            <Field
              id="recipient-email"
              label="Email"
              onChange={(value) => setDraft((current) => ({ ...current, email: value }))}
              placeholder="ravi@example.com"
              type="email"
              value={draft.email}
            />
            <Field
              id="recipient-phone"
              hint="Digits with the country code: 919876543210"
              label="Phone"
              onChange={(value) => setDraft((current) => ({ ...current, phone: value }))}
              placeholder="919876543210"
              value={draft.phone}
            />
            <Field
              id="recipient-identity"
              hint="Any reference your team uses."
              label="Identity"
              onChange={(value) =>
                setDraft((current) => ({ ...current, identity: value }))
              }
              placeholder="CUST-1042"
              value={draft.identity}
            />
          </div>
          <div className="flex justify-end">
            <Button disabled={disabled} size="sm" type="submit" variant="brand">
              <Plus />
              Add to list
            </Button>
          </div>
        </form>
      ) : null}

      {report ? <Report report={report} onDismiss={() => setReport(null)} /> : null}

      {error ? (
        <p
          className="rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12px] leading-relaxed text-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="sticky top-0 bg-secondary/90 backdrop-blur">
                <tr className="text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">
                  <th className="px-2.5 py-1.5 font-semibold">Name</th>
                  <th className="px-2.5 py-1.5 font-semibold">Phone</th>
                  <th className="hidden px-2.5 py-1.5 font-semibold sm:table-cell">
                    Email
                  </th>
                  <th className="hidden px-2.5 py-1.5 font-semibold sm:table-cell">
                    Identity
                  </th>
                  <th className="w-8 px-1" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, VISIBLE_ROWS).map((row, index) => (
                  <tr
                    className="border-t border-border/70"
                    key={`${row.phone}-${index}`}
                  >
                    <td className="max-w-32 truncate px-2.5 py-1.5 text-foreground">
                      {row.name || "—"}
                    </td>
                    <td className="px-2.5 py-1.5 font-mono text-[12px] whitespace-nowrap text-foreground">
                      {row.phone}
                    </td>
                    <td className="hidden max-w-40 truncate px-2.5 py-1.5 text-muted-foreground sm:table-cell">
                      {row.email || "—"}
                    </td>
                    <td className="hidden max-w-28 truncate px-2.5 py-1.5 text-muted-foreground sm:table-cell">
                      {row.identity || "—"}
                    </td>
                    <td className="px-1 py-1 text-right">
                      <button
                        aria-label={`Remove ${row.phone}`}
                        className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-ring/40 focus-visible:ring-[3px] focus-visible:outline-none disabled:opacity-50"
                        disabled={disabled}
                        onClick={() => remove(index)}
                        type="button"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length > VISIBLE_ROWS ? (
            <p className="border-t border-border bg-secondary/40 px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
              Showing the first {VISIBLE_ROWS} of {rows.length}. All of them are
              saved.
            </p>
          ) : null}
        </div>
      ) : null}

      {action ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            disabled={disabled || action.disabled || action.busy}
            onClick={action.onClick}
            size="sm"
            type="button"
            variant="brand"
          >
            {action.busy ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
            {action.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** What an import did, said once, above the rows it changed. */
function Report({
  report,
  onDismiss,
}: {
  report: ImportReport;
  onDismiss: () => void;
}) {
  const { rows, duplicates, invalid } = report;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        rows.length > 0
          ? "border-whatsapp/40 bg-whatsapp/10"
          : "border-warning/45 bg-warning/10",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] leading-relaxed text-foreground">
          <span className="font-semibold">
            {rows.length} number{rows.length === 1 ? "" : "s"} added
          </span>
          {duplicates.count > 0 ? (
            <>
              {" · "}
              {duplicates.count} duplicate
              {duplicates.count === 1 ? "" : "s"} removed automatically
            </>
          ) : null}
          {invalid.count > 0 ? (
            <>
              {" · "}
              {invalid.count} row{invalid.count === 1 ? "" : "s"} skipped
            </>
          ) : null}
        </p>
        <button
          aria-label="Dismiss the import summary"
          className="-mt-0.5 grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-ring/40 focus-visible:ring-[3px] focus-visible:outline-none"
          onClick={onDismiss}
          type="button"
        >
          <X className="size-3" />
        </button>
      </div>

      {duplicates.count > 0 ? (
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
          Already in this list: {duplicates.phones.join(", ")}
          {duplicates.count > duplicates.phones.length
            ? ` and ${duplicates.count - duplicates.phones.length} more`
            : ""}
          .
        </p>
      ) : null}

      {invalid.count > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {invalid.rows.slice(0, 3).map((row, index) => (
            <li
              className="text-[11.5px] leading-relaxed text-muted-foreground"
              key={`${row.phone}-${index}`}
            >
              <span className="font-mono text-foreground">
                {row.phone || "(empty)"}
              </span>{" "}
              — {row.reason}
            </li>
          ))}
          {invalid.count > 3 ? (
            <li className="text-[11.5px] text-muted-foreground">
              and {invalid.count - 3} more.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  placeholder,
  hint,
  type = "text",
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  hint?: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11.5px]" htmlFor={id}>
        {label}
      </Label>
      <input
        className={FIELD}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        type={type}
        value={value}
      />
      {hint ? (
        <p className="text-[10.5px] leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** The template the panel offers: the headers, and two rows that show them. */
function download() {
  const blob = new Blob([recipientTemplate()], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "campaign-recipients-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}
