import type { ParameterFormat } from "@prisma/client";

/**
 * Turning an approved template into a send.
 *
 * `MessageTemplate.components` is the array Meta accepted at creation, so a
 * send fills that array rather than rebuilding it: the tokens come from the
 * text Meta actually approved, which means a template edited in Meta's console
 * cannot disagree with what this file produces.
 *
 * Send components use lowercase `type` names — that is the shape the Messages
 * API documents, and it differs from the uppercase names creation takes.
 */

const VARIABLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export interface TemplateUrlButton {
  /** Position in the BUTTONS array, which is what Meta's `index` refers to. */
  index: number;
  /** The address as approved. It may end in a variable. */
  url: string;
  hasVariable: boolean;
}

export interface TemplateShape {
  header: string | null;
  /**
   * The HEADER's `format` as Meta wrote it: TEXT, IMAGE, VIDEO, DOCUMENT.
   * An image header carries no text, so `header` alone cannot tell a send
   * whether a media parameter is owed.
   */
  headerFormat: string | null;
  body: string;
  footer: string | null;
  /** Header then body, in first-appearance order — the order Meta fills them. */
  tokens: string[];
  urlButtons: TemplateUrlButton[];
}

/** Header formats whose parameter is a file rather than a string. */
const MEDIA_HEADERS = new Set(["IMAGE", "VIDEO", "DOCUMENT"]);

/** The `tap_target_configuration` override: the title a customer taps. */
export interface TapTarget {
  url: string;
  title: string;
}

export interface TemplateMessage {
  components: unknown[];
  /** What the customer reads, for the bubble and the queue preview. */
  body: string;
  tapTarget: TapTarget | null;
}

export interface TemplateSendInput {
  shape: TemplateShape;
  format: ParameterFormat;
  /** Token without braces (`1`, `first_name`) → the value to fill in. */
  values: Record<string, string>;
  /** Button index → the full address that button opens. */
  buttonUrls: Record<string, string>;
  /** The stored sample as a link Meta can fetch, for a media header. */
  headerImage?: string | null;
  tapTarget: TapTarget | null;
}

/**
 * The parts of a template a send has to fill. Everything is read defensively:
 * a row synced from Meta may have been written before a field existed.
 */
export function shapeOf(components: unknown): TemplateShape {
  const list = Array.isArray(components) ? components : [];
  const headerComponent = find(list, "HEADER");

  const header = textOf(headerComponent);
  const headerFormat = formatOf(headerComponent);
  const body = textOf(find(list, "BODY")) ?? "";
  const footer = textOf(find(list, "FOOTER"));

  const urlButtons = list
    .flatMap((component) => (record(component)?.type === "BUTTONS" ? asArray(record(component)?.buttons) : []))
    .flatMap((button, index) => {
      const entry = record(button);

      if (entry?.type !== "URL" || typeof entry.url !== "string" || !entry.url) {
        return [];
      }

      return [
        {
          index,
          url: entry.url,
          hasVariable: variablesIn(entry.url).length > 0,
        },
      ];
    });

  return {
    header,
    headerFormat,
    body,
    footer,
    // One entry per token: Meta fills a header and a body from the same
    // namespace, so `{{1}}` in both is one value, not two to ask for.
    tokens: [...new Set([...variablesIn(header ?? ""), ...variablesIn(body)])],
    urlButtons,
  };
}

/**
 * Everything that would make Meta refuse the send, in the order the composer
 * should list it. Returning the list rather than throwing keeps this module
 * free of HTTP concerns, exactly like `templates.payload.ts`.
 */
export function problemsIn(input: TemplateSendInput): string[] {
  const problems: string[] = [];

  for (const token of input.shape.tokens) {
    if (!input.values[token]?.trim()) {
      problems.push(`Fill in {{${token}}}.`);
    }
  }

  for (const button of input.shape.urlButtons) {
    if (!button.hasVariable) continue;

    const url = input.buttonUrls[String(button.index)]?.trim() ?? "";

    if (!url) {
      problems.push(`Fill in the link for the “${button.url}” button.`);
    } else if (!/^https?:\/\//i.test(url)) {
      problems.push("A button link needs to start with http:// or https://.");
    }
  }

  if (input.tapTarget) {
    if (input.shape.urlButtons.length === 0) {
      problems.push(
        "A tappable message needs a URL button, because the tap opens that button's destination.",
      );
    }

    if (!input.tapTarget.title.trim()) {
      problems.push("Give the tap target a title.");
    }

    if (!/^https?:\/\//i.test(input.tapTarget.url.trim())) {
      problems.push("The tap target needs an address starting with http:// or https://.");
    }
  }

  return problems;
}

/**
 * The one thing `problemsIn` cannot see: a media header is owed a file, and a
 * campaign draft has none until send time. Returning the sentence keeps the
 * caller free to raise it as a 409 (inbox) or a failed recipient (campaign).
 */
export function headerMediaProblem(
  shape: TemplateShape,
  link: string | null,
): string | null {
  if (!MEDIA_HEADERS.has(shape.headerFormat ?? "")) return null;

  if (shape.headerFormat !== "IMAGE") {
    return `This template's header is a ${shape.headerFormat?.toLowerCase()}, which the inbox cannot send yet.`;
  }

  return link
    ? null
    : "This template's header is an image, but no image is stored for this template here. Meta rejects a template send whose image header is empty.";
}

/** The send payload, once `problemsIn` has returned nothing. */
export function buildMessage(input: TemplateSendInput): TemplateMessage {
  const components: unknown[] = [];
  const { shape, format } = input;

  const headerTokens = variablesIn(shape.header ?? "");

  // A media header is one parameter holding the file's link. It replaces the
  // text parameter, never joins it: Meta refuses a header with both.
  if (shape.headerFormat === "IMAGE" && input.headerImage) {
    components.push({
      type: "header",
      parameters: [
        { type: "image", image: { link: input.headerImage.trim() } },
      ],
    });
  } else if (headerTokens.length > 0) {
    components.push({
      type: "header",
      parameters: headerTokens.map((token) =>
        textParam(token, input.values[token], format),
      ),
    });
  }

  const bodyTokens = variablesIn(shape.body);

  if (bodyTokens.length > 0) {
    components.push({
      type: "body",
      parameters: bodyTokens.map((token) =>
        textParam(token, input.values[token], format),
      ),
    });
  }

  for (const button of shape.urlButtons) {
    if (!button.hasVariable) continue;

    const url = input.buttonUrls[String(button.index)]?.trim();

    if (!url) continue;

    components.push({
      type: "button",
      sub_type: "url",
      index: String(button.index),
      parameters: [{ type: "text", text: url }],
    });
  }

  const tapTarget = input.tapTarget
    ? { url: input.tapTarget.url.trim(), title: input.tapTarget.title.trim() }
    : null;

  if (tapTarget) {
    // The shape the doc documents: the component wraps a list that wraps the
    // override itself.
    components.push({
      type: "tap_target_configuration",
      parameters: [
        {
          type: "tap_target_configuration",
          tap_target_configuration: [tapTarget],
        },
      ],
    });
  }

  return {
    components,
    body: readable(shape, input.values),
    tapTarget,
  };
}

/**
 * Named parameters carry their token; positional ones are filled in the order
 * Meta expects, which is why the tokens above are read in appearance order.
 */
function textParam(
  token: string,
  value: string | undefined,
  format: ParameterFormat,
): Record<string, string> {
  const text = value?.trim() ?? "";

  return format === "NAMED"
    ? { type: "text", parameter_name: token, text }
    : { type: "text", text };
}

/**
 * The message as the customer reads it. Sent, approved bodies keep their
 * `{{n}}` tokens, so the bubble would show placeholders without this.
 */
function readable(shape: TemplateShape, values: Record<string, string>): string {
  const text = (value: string | null) =>
    (value ?? "").replace(VARIABLE, (whole, token: string) => {
      const filled = values[token]?.trim();
      return filled ? filled : whole;
    });

  return [text(shape.header), text(shape.body), text(shape.footer)]
    .map((part) => part.trim())
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

function formatOf(value: unknown): string | null {
  const format = record(value)?.format;

  return typeof format === "string" && format.trim()
    ? format.trim().toUpperCase()
    : null;
}
