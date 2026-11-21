/**
 * Meta's components array, read back into the four things a template is.
 *
 * The list stores exactly what Meta holds — including media headers, which
 * carry no text at all — so this reader reports what is there and says
 * nothing about what should be. `headerKind` is how a card can say "image
 * header" instead of drawing an empty line.
 */

export interface TemplateButtonFact {
  type: string;
  text: string | null;
}

export interface TemplateParts {
  /** `TEXT` header body, or null when the header is media or absent. */
  header: string | null;
  /** Meta's header format, uppercase (`TEXT`, `IMAGE`, `VIDEO`, `DOCUMENT`). */
  headerKind: string | null;
  body: string;
  footer: string | null;
  buttons: TemplateButtonFact[];
}

const EMPTY: TemplateParts = {
  header: null,
  headerKind: null,
  body: "",
  footer: null,
  buttons: [],
};

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function templateParts(components: unknown): TemplateParts {
  if (!Array.isArray(components)) return EMPTY;

  const parts: TemplateParts = { ...EMPTY, buttons: [] };

  for (const entry of components) {
    const component = record(entry);
    if (!component) continue;

    const type = String(component.type ?? "").toUpperCase();

    if (type === "HEADER") {
      const format = String(component.format ?? "TEXT").toUpperCase();
      parts.headerKind = format;
      parts.header = format === "TEXT" ? textOf(component.text) : null;
      continue;
    }

    if (type === "BODY") {
      parts.body = textOf(component.text) ?? "";
      continue;
    }

    if (type === "FOOTER") {
      parts.footer = textOf(component.text);
      continue;
    }

    if (type === "BUTTONS" && Array.isArray(component.buttons)) {
      parts.buttons = component.buttons.flatMap((entry) => {
        const button = record(entry);
        if (!button) return [];

        const kind = String(button.type ?? "").toUpperCase();
        if (!kind) return [];

        return [{ type: kind, text: textOf(button.text) }];
      });
    }
  }

  return parts;
}
