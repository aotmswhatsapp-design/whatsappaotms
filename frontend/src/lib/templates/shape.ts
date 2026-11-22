/**
 * Reading a template's components on the client.
 *
 * The composer has to know what a send will ask for *before* it asks: which
 * tokens to fill, which URL buttons carry a variable, and what the message
 * will look like. `components` is Meta's array as approved, so this file only
 * reads it — the same reading the API does when it builds the payload.
 */

const VARIABLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export interface TemplateUrlButton {
  /** Position in the whole buttons array, which is what Meta's `index` means. */
  index: number;
  url: string;
  /** The label on the button; Meta falls back to "Open link" when empty. */
  text: string | null;
  hasVariable: boolean;
}

export interface TemplateShape {
  header: string | null;
  /** Meta's header format, uppercase — `IMAGE` means the preview can show one. */
  headerKind: string | null;
  body: string;
  footer: string | null;
  /** Header then body, in first-appearance order — the order Meta fills them. */
  tokens: string[];
  urlButtons: TemplateUrlButton[];
}

export function shapeOf(components: unknown): TemplateShape {
  const list = Array.isArray(components) ? components : [];

  const headerComponent = record(find(list, "HEADER"));
  const header = textOf(headerComponent);
  const headerKind = headerComponent
    ? String(headerComponent.format ?? "TEXT").toUpperCase()
    : null;
  const body = textOf(find(list, "BODY")) ?? "";
  const footer = textOf(find(list, "FOOTER"));

  const buttons = list.flatMap((component) =>
    record(component)?.type === "BUTTONS"
      ? asArray(record(component)?.buttons)
      : [],
  );

  const urlButtons = buttons.flatMap((button, index) => {
    const entry = record(button);

    if (entry?.type !== "URL" || typeof entry.url !== "string" || !entry.url) {
      return [];
    }

    return [
      {
        index,
        url: entry.url,
        text:
          typeof entry.text === "string" && entry.text.trim()
            ? entry.text.trim()
            : null,
        hasVariable: variablesIn(entry.url).length > 0,
      },
    ];
  });

  return {
    header,
    headerKind,
    body,
    footer,
    // One entry per token: Meta fills a header and a body from the same
    // namespace, so `{{1}}` in both is one value, not two to ask for.
    tokens: [...new Set([...variablesIn(header ?? ""), ...variablesIn(body)])],
    urlButtons,
  };
}

/** Replaces each `{{token}}` with its value, leaving unfilled ones visible. */
export function fill(text: string, values: Record<string, string>): string {
  return text.replace(VARIABLE, (whole, token: string) => {
    const value = values[token]?.trim();
    return value ? value : whole;
  });
}

/** The message as the customer will read it, for the panel's preview. */
export function readable(shape: TemplateShape, values: Record<string, string>): string {
  return [shape.header, shape.body, shape.footer]
    .map((part) => (part ? fill(part, values).trim() : ""))
    .filter(Boolean)
    .join("\n\n");
}

function variablesIn(text: string): string[] {
  const found = new Set<string>();

  for (const match of text.matchAll(VARIABLE)) {
    found.add(match[1]);
  }

  return [...found];
}

function find(list: unknown[], type: string): unknown {
  return list.find((component) => record(component)?.type === type);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textOf(value: unknown): string | null {
  const text = record(value)?.text;

  return typeof text === "string" && text.trim() ? text : null;
}
