import type {
  ParameterFormat,
  TemplateButton,
  TemplateCategory,
} from "./api";
import { variablesOf } from "./format";

/**
 * Meta's limits, checked here so the builder can answer before a round trip.
 *
 * These are a copy of the API's `templates.payload.ts` and not the authority:
 * the server re-checks every one of them and its reply is what the form shows
 * when they disagree. Keeping the copy means a 1025-character body is a
 * counter turning red, not a 400.
 */
export const LIMITS = {
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
const NAMED = /^[a-z][a-z0-9_]*$/;
const POSITIONAL = /^\d+$/;

/** The form's state, flat, so validation has one object to read. */
export interface DraftValues {
  name: string;
  category: TemplateCategory;
  language: string;
  parameterFormat: ParameterFormat;
  header: string;
  body: string;
  footer: string;
  examples: Record<string, string>;
}

/**
 * Every problem at once, in form order. A customer who used `{{First Name}}`
 * in three places sees one list naming all three, matching the API's answer.
 */
export function problemsIn(values: DraftValues, buttons: TemplateButton[]): string[] {
  const problems: string[] = [];
  const name = values.name.trim();
  const body = values.body.trim();
  const header = values.header.trim();
  const footer = values.footer.trim();

  if (!NAME.test(name)) {
    problems.push(
      "The name may only use lowercase letters, numbers and underscores — it is how code refers to this template.",
    );
  } else if (name.length > LIMITS.nameMax) {
    problems.push(`The name is ${name.length} characters; Meta allows ${LIMITS.nameMax}.`);
  }

  if (!body) {
    problems.push("A body is required — it is the only mandatory component.");
  } else if (body.length > LIMITS.bodyMax) {
    problems.push(`The body is ${body.length} characters; Meta allows ${LIMITS.bodyMax}.`);
  }

  if (header.length > LIMITS.headerMax) {
    problems.push(`The header is ${header.length} characters; Meta allows ${LIMITS.headerMax}.`);
  }

  if (footer.length > LIMITS.footerMax) {
    problems.push(`The footer is ${footer.length} characters; Meta allows ${LIMITS.footerMax}.`);
  }

  const headerVariables = variablesOf(header);

  if (headerVariables.length > 1) {
    problems.push("A text header supports one variable. Move the rest into the body.");
  }

  const variables = variablesOf(header, body);

  for (const token of variables) {
    if (values.parameterFormat === "POSITIONAL" && !POSITIONAL.test(token)) {
      problems.push(
        `{{${token}}} is not a positional variable. Use {{1}}, {{2}}, … or switch the format to named.`,
      );
    }

    if (values.parameterFormat === "NAMED" && !NAMED.test(token)) {
      problems.push(
        `{{${token}}} is not a named variable. Use lowercase letters, numbers and underscores.`,
      );
    }

    if (!values.examples[token]?.trim()) {
      problems.push(`Give an example value for {{${token}}}.`);
    }
  }

  if (values.parameterFormat === "POSITIONAL" && variables.length > 0) {
    const indexes = variables.map(Number).sort((left, right) => left - right);

    if (indexes[0] !== 1 || indexes[indexes.length - 1] !== indexes.length) {
      problems.push("Positional variables must run from {{1}} upwards with no gaps.");
    }
  } else if (values.parameterFormat === "NAMED" && variables.some((token) => POSITIONAL.test(token))) {
    problems.push(
      "Named templates use words as parameters. Rename {{1}} to something like {{first_name}}, or switch to positional.",
    );
  }

  problems.push(...buttonProblems(buttons));

  return problems;
}

export function buttonProblems(buttons: TemplateButton[]): string[] {
  const problems: string[] = [];

  if (buttons.length > LIMITS.buttonsMax) {
    problems.push(`A template allows ${LIMITS.buttonsMax} buttons in total.`);
  }

  const count = (type: TemplateButton["type"]) =>
    buttons.filter((button) => button.type === type).length;

  if (count("QUICK_REPLY") > LIMITS.quickReplyMax) {
    problems.push(`A template allows ${LIMITS.quickReplyMax} quick replies.`);
  }

  if (count("URL") > LIMITS.urlMax) {
    problems.push(`A template allows ${LIMITS.urlMax} link buttons.`);
  }

  if (count("PHONE_NUMBER") > LIMITS.phoneMax) {
    problems.push("A template allows one call button.");
  }

  if (count("COPY_CODE") > LIMITS.copyCodeMax) {
    problems.push("A template allows one copy code button.");
  }

  for (const button of buttons) {
    const text = button.text?.trim() ?? "";

    if (button.type !== "COPY_CODE") {
      if (!text) {
        problems.push("Every button needs a label.");
      } else if (text.length > LIMITS.buttonTextMax) {
        problems.push(`Button labels are limited to ${LIMITS.buttonTextMax} characters.`);
      }
    }

    if (button.type === "URL") {
      const url = button.url?.trim() ?? "";

      if (!/^https?:\/\//i.test(url)) {
        problems.push("A link button needs an address starting with http:// or https://.");
      }

      const variables = variablesOf(url);

      if (variables.length > 1) {
        problems.push("A link button supports one variable, and it must be {{1}}.");
      }

      if (variables.length === 1 && variables[0] !== "1") {
        problems.push("A link button's variable is always {{1}}.");
      }

      if (variables.length === 1 && !button.urlExample?.trim()) {
        problems.push("Give an example address for the link button's variable.");
      }
    }

    if (button.type === "PHONE_NUMBER" && !button.phoneNumber?.trim()) {
      problems.push("A call button needs the number to dial.");
    }

    if (button.type === "COPY_CODE") {
      const example = button.codeExample?.trim() ?? "";

      if (!example) {
        problems.push("A copy code button needs the code it copies.");
      } else if (example.length > LIMITS.copyCodeExampleMax) {
        problems.push(
          `The copied code is limited to ${LIMITS.copyCodeExampleMax} characters.`,
        );
      }
    }
  }

  return problems;
}
