/**
 * Reading a template back into the builder.
 *
 * The catalogue only ever needs a preview, so `components-shape.ts` answers
 * with text and button labels. An edit needs everything the form can change —
 * addresses, numbers, codes and the examples Meta checked — so this reader is
 * the inverse of the API's `buildComponents`, field for field.
 *
 * It also decides which rows open at all. An edit replaces the whole message,
 * so a component this build cannot write must keep the editor closed rather
 * than be dropped on save.
 */

import type {
  HeaderFormat,
  ParameterFormat,
  TemplateButtonType,
  TemplateCategory,
  TemplateFacts,
} from "./api";
import type { DraftButton } from "./components/button-list";
import { variablesOf } from "./format";
import type { DraftValues } from "./rules";

/** Meta's review states an edit is accepted on — the same set the API allows. */
const EDITABLE = new Set(["APPROVED", "REJECTED", "PAUSED"]);

const BUTTON_TYPES = ["QUICK_REPLY", "URL", "PHONE_NUMBER", "COPY_CODE"] as const;

/** The header kinds the builder can write. Meta has video and document too. */
const WRITABLE_HEADERS = new Set(["TEXT", "IMAGE"]);

export interface EditDraft {
  values: DraftValues;
  buttons: DraftButton[];
}

/**
 * Why this row cannot be opened in the builder, or null when it can.
 *
 * Stated as a sentence rather than a boolean because the screen shows it: a
 * template in review has nothing wrong with it, it simply has no verdict to
 * change yet.
 */
export function editBlocker(facts: TemplateFacts): string | null {
  if (!facts.metaId) {
    return "This template never reached Meta, so there is nothing there to edit.";
  }

  if (!EDITABLE.has(facts.status)) {
    if (facts.status === "PENDING") {
      return "Meta is still reviewing this template. Editing opens once it has a verdict.";
    }

    if (facts.status === "DISABLED") {
      return "Meta disabled this template. An appeal in WhatsApp Manager has to clear before it can be edited.";
    }

    if (facts.status === "DELETED" || facts.status === "PENDING_DELETION") {
      return "This template is being deleted at Meta, so it can no longer be edited.";
    }

    return `Meta does not accept edits on a template that is ${facts.status
      .toLowerCase()
      .replace(/_/g, " ")}.`;
  }

  const kind = headerKind(facts.components);

  if (kind !== null && !WRITABLE_HEADERS.has(kind)) {
    return `This template has a ${kind.toLowerCase()} header. This screen writes text and image headers, so it cannot save this one without dropping the header — edit it in WhatsApp Manager.`;
  }

  const button = unwritableButton(facts.components);

  if (button !== null) {
    return `This template has a ${button.toLowerCase().replace(/_/g, " ")} button, which this screen cannot write. Editing it here would drop that button — edit it in WhatsApp Manager.`;
  }

  return null;
}

/** A deleted row has nothing left to delete, and Meta refuses a disabled one. */
export function canDelete(facts: TemplateFacts): boolean {
  return facts.status !== "DELETED" && facts.status !== "DISABLED";
}

/**
 * The form's starting state for an existing template.
 *
 * Examples are read back by position for a positional template and by
 * `param_name` for a named one, because Meta keeps the two shapes differently.
 * A URL button's example is stored as the rendered address, so the variable is
 * recovered by stripping the parts around `{{1}}` — that is what the API
 * substitutes to build the same address again.
 */
export function draftOf(facts: TemplateFacts): EditDraft {
  const components = Array.isArray(facts.components) ? facts.components : [];

  let header = "";
  let headerFormat: HeaderFormat = "TEXT";
  let body = "";
  let footer = "";
  const examples: Record<string, string> = {};
  const buttons: DraftButton[] = [];

  for (const entry of components) {
    const component = record(entry);
    if (!component) continue;

    const type = upper(component.type);

    if (type === "HEADER") {
      headerFormat = upper(component.format) === "IMAGE" ? "IMAGE" : "TEXT";
      header = headerFormat === "TEXT" ? text(component.text) : "";
      readExamples(component.example, variablesOf(header), examples);
      continue;
    }

    if (type === "BODY") {
      body = text(component.text);
      readExamples(component.example, variablesOf(body), examples);
      continue;
    }

    if (type === "FOOTER") {
      footer = text(component.text);
      continue;
    }

    if (type === "BUTTONS" && Array.isArray(component.buttons)) {
      for (const raw of component.buttons) {
        const button = readButton(raw);
        if (button) buttons.push(button);
      }
    }
  }

  return {
    values: {
      name: facts.name,
      category: categoryOf(facts.category),
      language: facts.language,
      parameterFormat: parameterFormatOf(facts.parameterFormat),
      headerFormat,
      header,
      // Kept so an image header survives an edit that only rewrote the body:
      // omitting it from the payload tells the API to re-mint the stored copy.
      mediaPath: facts.mediaPath ?? "",
      body,
      footer,
      examples,
    },
    buttons,
  };
}

let counter = 0;

function readButton(raw: unknown): DraftButton | null {
  const button = record(raw);
  if (!button) return null;

  // Meta has button types this screen cannot write (flows, OTP). A row that
  // carries one never reaches this reader: `editBlocker` refuses it first.
  const kind = upper(button.type);
  if (!(BUTTON_TYPES as readonly string[]).includes(kind)) return null;

  const type = kind as TemplateButtonType;
  counter += 1;

  const draft: DraftButton = { key: `seed-${counter}`, type };

  if (type === "COPY_CODE") {
    const code = text(button.example);
    if (code) draft.codeExample = code;
    return draft;
  }

  const label = text(button.text);
  if (label) draft.text = label;

  if (type === "URL") {
    const url = text(button.url);
    if (url) draft.url = url;

    const value = urlVariableValue(url, button.example);
    if (value) draft.urlExample = value;
  }

  if (type === "PHONE_NUMBER") {
    const phone = text(button.phone_number);
    if (phone) draft.phoneNumber = phone;
  }

  return draft;
}

/** `{ header_text: [...] }` and `{ body_text: [[...]] }`, in the form's order. */
function readExamples(
  raw: unknown,
  tokens: string[],
  into: Record<string, string>,
): void {
  if (tokens.length === 0) return;

  const example = record(raw);
  if (!example) return;

  const named = namedExamples(example);

  if (named) {
    for (const [token, value] of named) into[token] = value;
    return;
  }

  const positional = positionalExamples(example);

  if (!positional) return;

  tokens.forEach((token, index) => {
    const value = positional[index];
    if (value) into[token] = value;
  });
}

function namedExamples(example: Record<string, unknown>): Map<string, string> | null {
  for (const value of Object.values(example)) {
    if (!Array.isArray(value)) continue;

    const pairs = value.flatMap((entry) => {
      const pair = record(entry);
      const name = pair ? text(pair.param_name) : "";
      const sample = pair ? text(pair.example) : "";

      return name && sample ? [[name, sample] as const] : [];
    });

    if (pairs.length > 0) return new Map(pairs);
  }

  return null;
}

function positionalExamples(example: Record<string, unknown>): string[] | null {
  for (const [key, value] of Object.entries(example)) {
    if (key.endsWith("_named_params")) continue;
    if (!Array.isArray(value) || value.length === 0) continue;

    // A body keeps one array per example set; a header is a flat list.
    const flat = Array.isArray(value[0]) ? (value[0] as unknown[]) : value;

    return flat.map((entry) => text(entry));
  }

  return null;
}

/**
 * The value typed into a link button's `{{1}}`, recovered from the address Meta
 * stored. Anything that does not line up answers empty rather than a guess.
 */
function urlVariableValue(url: string, example: unknown): string {
  if (!url || !Array.isArray(example)) return "";

  const rendered = typeof example[0] === "string" ? example[0].trim() : "";
  if (!rendered) return "";

  const parts = url.split(/\{\{\s*1\s*\}\}/);
  if (parts.length !== 2) return "";

  const [before, after] = parts;
  if (!rendered.startsWith(before)) return "";

  const middle = rendered.slice(before.length);
  if (after && !middle.endsWith(after)) return "";

  return after ? middle.slice(0, middle.length - after.length) : middle;
}

/** Meta's header format for the whole row, uppercase, or null when there is none. */
function headerKind(components: unknown): string | null {
  if (!Array.isArray(components)) return null;

  for (const entry of components) {
    const component = record(entry);

    if (component && upper(component.type) === "HEADER") {
      // A header without a `format` is a text header on the oldest payloads.
      return upper(component.format) || "TEXT";
    }
  }

  return null;
}

/** The first button this build cannot write, or null when it writes them all. */
function unwritableButton(components: unknown): string | null {
  if (!Array.isArray(components)) return null;

  for (const entry of components) {
    const component = record(entry);

    if (!component || upper(component.type) !== "BUTTONS") continue;
    if (!Array.isArray(component.buttons)) continue;

    for (const raw of component.buttons) {
      const button = record(raw);
      const kind = button ? upper(button.type) : "";

      if (kind && !(BUTTON_TYPES as readonly string[]).includes(kind)) return kind;
    }
  }

  return null;
}

function categoryOf(raw: string): TemplateCategory | "" {
  const value = upper(raw);

  return value === "MARKETING" || value === "UTILITY" || value === "AUTHENTICATION"
    ? value
    : "";
}

function parameterFormatOf(raw: string): ParameterFormat {
  return upper(raw) === "NAMED" ? "NAMED" : "POSITIONAL";
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function upper(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}
