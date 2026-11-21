/**
 * Meta's template wire format, in one place.
 *
 * The API takes a friendly draft (a headline, a body, buttons, one map of
 * example values) and this file turns it into the `components` array Meta
 * accepts. Keeping the translation here means the service never assembles JSON,
 * and the same rules can be re-read when a rejection is investigated.
 *
 * Two shapes matter and are easy to get wrong:
 * - positional examples are a *nested* array (`body_text: [[…]]`), because Meta
 *   allows several example sets; named examples are objects with `param_name`.
 * - a text header carries at most one variable, while a body carries many.
 */

export type TemplateCategoryName = "AUTHENTICATION" | "MARKETING" | "UTILITY";
export type ParameterFormatName = "NAMED" | "POSITIONAL";
export type TemplateButtonType =
  | "QUICK_REPLY"
  | "URL"
  | "PHONE_NUMBER"
  | "COPY_CODE";

export interface TemplateButtonInput {
  type: TemplateButtonType;
  /** Label. Everything except a copy-code button needs one, 25 chars max. */
  text?: string | null;
  /** URL buttons only. May contain `{{1}}`. */
  url?: string | null;
  /** The example URL Meta asks for when the URL carries a variable. */
  urlExample?: string | null;
  /** Phone-call buttons only. */
  phoneNumber?: string | null;
  /** Copy-code buttons only: the text the tap puts on the clipboard. */
  codeExample?: string | null;
}

export interface TemplateDraft {
  name: string;
  category: TemplateCategoryName;
  language: string;
  parameterFormat: ParameterFormatName;
  header?: string | null;
  body: string;
  footer?: string | null;
  buttons?: TemplateButtonInput[];
  /** Variable token without braces (`1`, `first_name`) → its example value. */
  examples?: Record<string, string>;
}

/** Meta's published limits, named so the validator and the UI agree. */
export const TEMPLATE_LIMITS = {
  nameMax: 512,
  headerMax: 60,
  bodyMax: 1024,
  footerMax: 60,
  buttonsMax: 10,
  buttonTextMax: 25,
  quickReplyMax: 10,
  urlMax: 2,
  phoneMax: 1,
  copyCodeMax: 1,
  copyCodeExampleMax: 20,
} as const;

const NAME = /^[a-z0-9_]+$/;
const VARIABLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Every `{{token}}` in a string, in the order it appears, duplicates kept. */
export function variablesIn(text: string): string[] {
  const found: string[] = [];

  for (const match of text.matchAll(VARIABLE)) {
    found.push(match[1]);
  }

  return found;
}

/**
 * Everything Meta would reject, said in terms of the form.
 *
 * Returned as a list rather than thrown one at a time: a customer who used
 * `{{First Name}}` in three places should see one reply that names all three,
 * not three round trips.
 */
export function problemsIn(draft: TemplateDraft): string[] {
  const problems: string[] = [];

  const name = draft.name?.trim() ?? "";
  const body = draft.body?.trim() ?? "";
  const header = draft.header?.trim() ?? "";
  const footer = draft.footer?.trim() ?? "";
  const buttons = draft.buttons ?? [];
  const examples = draft.examples ?? {};

  if (!NAME.test(name) || name.length > TEMPLATE_LIMITS.nameMax) {
    problems.push(
      `The name may only use lowercase letters, numbers and underscores, up to ${TEMPLATE_LIMITS.nameMax} characters.`,
    );
  }

  if (!body) {
    problems.push("A body is required — it is the only mandatory component.");
  } else if (body.length > TEMPLATE_LIMITS.bodyMax) {
    problems.push(
      `The body is ${body.length} characters; Meta allows ${TEMPLATE_LIMITS.bodyMax}.`,
    );
  }

  if (header.length > TEMPLATE_LIMITS.headerMax) {
    problems.push(
      `The header is ${header.length} characters; Meta allows ${TEMPLATE_LIMITS.headerMax}.`,
    );
  }

  if (footer.length > TEMPLATE_LIMITS.footerMax) {
    problems.push(
      `The footer is ${footer.length} characters; Meta allows ${TEMPLATE_LIMITS.footerMax}.`,
    );
  }

  const headerVariables = variablesIn(header);

  if (headerVariables.length > 1) {
    problems.push("A text header supports one variable. Move the rest into the body.");
  }

  const variables = [...new Set([...headerVariables, ...variablesIn(body)])];

  for (const variable of variables) {
    if (draft.parameterFormat === "POSITIONAL" && !/^\d+$/.test(variable)) {
      problems.push(
        `{{${variable}}} is not a positional variable. Use {{1}}, {{2}}, … or switch the format to named.`,
      );
    }

    if (draft.parameterFormat === "NAMED" && !/^[a-z][a-z0-9_]*$/.test(variable)) {
      problems.push(
        `{{${variable}}} is not a named variable. Use lowercase letters, numbers and underscores.`,
      );
    }

    if (!examples[variable]?.trim()) {
      problems.push(`Give an example value for {{${variable}}}.`);
    }
  }

  if (draft.parameterFormat === "POSITIONAL" && variables.length > 0) {
    const indexes = variables.map(Number).sort((a, b) => a - b);

    if (indexes[0] !== 1 || indexes[indexes.length - 1] !== indexes.length) {
      problems.push(
        "Positional variables must run from {{1}} upwards with no gaps.",
      );
    }
  }

  problems.push(...buttonProblems(buttons));

  return problems;
}

function buttonProblems(buttons: TemplateButtonInput[]): string[] {
  const problems: string[] = [];

  if (buttons.length > TEMPLATE_LIMITS.buttonsMax) {
    problems.push(`A template allows ${TEMPLATE_LIMITS.buttonsMax} buttons in total.`);
  }

  const count = (type: TemplateButtonType) =>
    buttons.filter((button) => button.type === type).length;

  if (count("QUICK_REPLY") > TEMPLATE_LIMITS.quickReplyMax) {
    problems.push(`A template allows ${TEMPLATE_LIMITS.quickReplyMax} quick replies.`);
  }

  if (count("URL") > TEMPLATE_LIMITS.urlMax) {
    problems.push(`A template allows ${TEMPLATE_LIMITS.urlMax} URL buttons.`);
  }

  if (count("PHONE_NUMBER") > TEMPLATE_LIMITS.phoneMax) {
    problems.push("A template allows one phone number button.");
  }

  if (count("COPY_CODE") > TEMPLATE_LIMITS.copyCodeMax) {
    problems.push("A template allows one copy code button.");
  }

  for (const button of buttons) {
    const text = button.text?.trim() ?? "";

    if (button.type !== "COPY_CODE") {
      if (!text) {
        problems.push(`Every ${button.type} button needs a label.`);
      } else if (text.length > TEMPLATE_LIMITS.buttonTextMax) {
        problems.push(
          `Button labels are limited to ${TEMPLATE_LIMITS.buttonTextMax} characters.`,
        );
      }
    }

    if (button.type === "URL") {
      const url = button.url?.trim() ?? "";

      if (!/^https?:\/\//i.test(url)) {
        problems.push("A URL button needs an address starting with http:// or https://.");
      }

      const variables = variablesIn(url);

      if (variables.length > 1) {
        problems.push("A URL button supports one variable.");
      }

      if (variables.length === 1 && !button.urlExample?.trim()) {
        problems.push("Give an example address for the URL button's variable.");
      }
    }

    if (button.type === "PHONE_NUMBER" && !button.phoneNumber?.trim()) {
      problems.push("A phone number button needs the number to dial.");
    }

    if (button.type === "COPY_CODE") {
      const example = button.codeExample?.trim() ?? "";

      if (!example) {
        problems.push("A copy code button needs the code it copies.");
      } else if (example.length > TEMPLATE_LIMITS.copyCodeExampleMax) {
        problems.push(
          `The copied code is limited to ${TEMPLATE_LIMITS.copyCodeExampleMax} characters.`,
        );
      }
    }
  }

  return problems;
}

/** The `components` array, in the order Meta documents: header, body, footer, buttons. */
export function buildComponents(draft: TemplateDraft): unknown[] {
  const components: unknown[] = [];

  const header = draft.header?.trim() ?? "";
  const body = draft.body.trim();
  const footer = draft.footer?.trim() ?? "";
  const buttons = draft.buttons ?? [];
  const examples = draft.examples ?? {};
  const named = draft.parameterFormat === "NAMED";

  if (header) {
    const variables = variablesIn(header);

    components.push({
      type: "HEADER",
      format: "TEXT",
      text: header,
      ...(variables.length > 0
        ? {
            example: named
              ? {
                  header_text_named_params: variables.map((variable) => ({
                    param_name: variable,
                    example: examples[variable],
                  })),
                }
              : { header_text: variables.map((variable) => examples[variable]) },
          }
        : {}),
    });
  }

  const bodyVariables = variablesIn(body);

  components.push({
    type: "BODY",
    text: body,
    ...(bodyVariables.length > 0
      ? {
          example: named
            ? {
                body_text_named_params: bodyVariables.map((variable) => ({
                  param_name: variable,
                  example: examples[variable],
                })),
              }
            : // One example set, hence the extra array level.
              { body_text: [bodyVariables.map((variable) => examples[variable])] },
        }
      : {}),
  });

  if (footer) {
    components.push({ type: "FOOTER", text: footer });
  }

  if (buttons.length > 0) {
    components.push({ type: "BUTTONS", buttons: buttons.map(buttonPayload) });
  }

  return components;
}

function buttonPayload(button: TemplateButtonInput): Record<string, unknown> {
  const text = button.text?.trim() ?? "";

  if (button.type === "URL") {
    const url = button.url?.trim() ?? "";
    const example = button.urlExample?.trim() ?? "";

    return {
      type: "URL",
      text,
      url,
      // Meta wants the *rendered* address, not the pattern, so the variable is
      // substituted here: `https://shop.example/{{1}}` + `1041` →
      // `https://shop.example/1041`.
      ...(variablesIn(url).length > 0 && example
        ? { example: [url.replace(/\{\{\s*1\s*\}\}/, example)] }
        : {}),
    };
  }

  if (button.type === "PHONE_NUMBER") {
    return { type: "PHONE_NUMBER", text, phone_number: button.phoneNumber?.trim() ?? "" };
  }

  if (button.type === "COPY_CODE") {
    return { type: "COPY_CODE", example: button.codeExample?.trim() ?? "" };
  }

  return { type: "QUICK_REPLY", text };
}
