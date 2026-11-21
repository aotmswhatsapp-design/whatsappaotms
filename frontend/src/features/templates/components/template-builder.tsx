"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  LoaderCircle,
  Send,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import {
  ApiError,
  createTemplate,
  type ParameterFormat,
  type TemplateButton,
  type TemplateCategory,
  type TemplateDraft,
} from "../api";
import { variablesOf } from "../format";
import { LIMITS, problemsIn, type DraftValues } from "../rules";
import { ButtonList, type DraftButton } from "./button-list";
import { ExampleFields } from "./example-fields";
import { LanguageSelect } from "./language-select";
import { TemplatePreview } from "./template-preview";

const CATEGORIES: { value: TemplateCategory; label: string; hint: string }[] = [
  {
    value: "MARKETING",
    label: "Marketing",
    hint: "Offers, launches and re-engagement. Meta reads these strictly for promotional wording.",
  },
  {
    value: "UTILITY",
    label: "Utility",
    hint: "Order updates, receipts and reminders — messages tied to something the customer did.",
  },
  {
    value: "AUTHENTICATION",
    label: "Authentication",
    hint: "Passcodes. Meta fixes the wording, so build these in WhatsApp Manager; a custom body is usually rejected.",
  },
];

const FORMATS: { value: ParameterFormat; label: string; hint: string; sample: string }[] = [
  {
    value: "POSITIONAL",
    label: "Positional",
    hint: "{{1}}, {{2}} — filled in order.",
    sample: "{{1}}",
  },
  {
    value: "NAMED",
    label: "Named",
    hint: "{{first_name}} — mapped by name.",
    sample: "{{first_name}}",
  },
];

const INITIAL: DraftValues = {
  name: "",
  category: "MARKETING",
  language: "en_US",
  parameterFormat: "POSITIONAL",
  header: "",
  body: "",
  footer: "",
  examples: {},
};

const FIELD = cn(
  "mt-1.5 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none transition-shadow",
  "placeholder:text-[13px] placeholder:text-muted-foreground/70",
  "focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]",
);

/**
 * The builder.
 *
 * It is one form because Meta takes one submission: name, category, language,
 * content, examples and buttons arrive together, and a template is either
 * created or not. Client validation mirrors the API's rules so the counters
 * turn red as you type, but the API stays the judge — its refusal is rendered
 * verbatim, because it is the only text that explains a Meta rejection.
 */
export function TemplateBuilder() {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = React.useState<DraftValues>(INITIAL);
  const [buttons, setButtons] = React.useState<DraftButton[]>([]);
  const [problems, setProblems] = React.useState<string[]>([]);
  const [refusal, setRefusal] = React.useState<{ title: string; detail: string } | null>(
    null,
  );
  const [pending, setPending] = React.useState(false);
  const problemsRef = React.useRef<HTMLDivElement>(null);

  // The card only exists after the refusal renders, so it is scrolled to from
  // an effect rather than from the handler that produced it.
  React.useEffect(() => {
    if (problems.length === 0 && !refusal) return;

    problemsRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [problems, refusal]);

  const tokens = variablesOf(values.header, values.body);
  const headerTokens = variablesOf(values.header);
  const format = FORMATS.find((entry) => entry.value === values.parameterFormat) ?? FORMATS[0];

  function update<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function setExample(token: string, value: string) {
    setValues((current) => ({
      ...current,
      examples: { ...current.examples, [token]: value },
    }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const found = problemsIn(values, buttons);

    if (found.length > 0) {
      setProblems(found);
      setRefusal(null);

      return;
    }

    setProblems([]);
    setRefusal(null);
    setPending(true);

    try {
      const created = await createTemplate(payloadOf(values, buttons));

      toast.push({
        title: "Sent to Meta",
        description: `${created.name} is in review. Meta answers with a status update, which this list follows automatically.`,
        tone: "success",
      });

      router.push("/workspace/templates");
    } catch (error) {
      if (error instanceof ApiError) {
        setRefusal({
          title:
            error.code === "TEMPLATE_INVALID"
              ? "The draft was refused"
              : error.status === 502
                ? "Meta refused the template"
                : "The template was not created",
          detail: error.message,
        });
      } else {
        setRefusal({
          title: "The template was not created",
          detail: "Something interrupted the request. Try again.",
        });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"
      noValidate
      onSubmit={submit}
    >
      <div className="min-w-0 space-y-5">
        {problems.length > 0 || refusal ? (
          <div
            className="rounded-xl border border-destructive/35 bg-destructive/5 p-4"
            ref={problemsRef}
            role="alert"
          >
            <h2 className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground">
              <TriangleAlert aria-hidden="true" className="size-4 text-destructive" />
              {refusal ? refusal.title : "Fix these before submitting"}
            </h2>

            {refusal ? (
              <p className="mt-1.5 text-[13px] leading-relaxed text-foreground">
                {refusal.detail}
              </p>
            ) : null}

            {problems.length > 0 ? (
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-foreground">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <Section
          description="How Meta files the template, and how code will refer to it."
          step={1}
          title="Details"
        >
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="template-name">Name</Label>
                <Counter max={LIMITS.nameMax} value={values.name.trim().length} />
              </div>
              <input
                autoCapitalize="off"
                autoComplete="off"
                className={cn(FIELD, "h-11 font-mono")}
                id="template-name"
                onChange={(event) =>
                  update(
                    "name",
                    event.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
                  )
                }
                placeholder="order_update"
                spellCheck={false}
                type="text"
                value={values.name}
              />
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                Lowercase letters, numbers and underscores. It is not unique:
                the same name may exist once per language.
              </p>
            </div>

            <div>
              <span className="text-sm font-medium text-foreground" id="template-category">
                Category
              </span>
              <div
                aria-labelledby="template-category"
                className="mt-1.5 grid gap-2 sm:grid-cols-3"
                role="radiogroup"
              >
                {CATEGORIES.map((entry) => {
                  const active = values.category === entry.value;

                  return (
                    <label
                      className={cn(
                        "cursor-pointer rounded-lg border p-3 transition-colors",
                        "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/30",
                        active
                          ? "border-brand bg-brand-soft/60"
                          : "border-border hover:bg-accent",
                      )}
                      key={entry.value}
                    >
                      <input
                        checked={active}
                        className="sr-only"
                        name="template-category"
                        onChange={() => update("category", entry.value)}
                        type="radio"
                        value={entry.value}
                      />
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[13.5px] font-medium text-foreground">
                          {entry.label}
                        </span>
                        <span
                          className={cn(
                            "grid size-4 shrink-0 place-items-center rounded-full border",
                            active
                              ? "border-brand bg-brand text-brand-foreground"
                              : "border-border",
                          )}
                        >
                          {active ? <Check aria-hidden="true" className="size-2.5" /> : null}
                        </span>
                      </span>
                      <span className="mt-1 block text-[12px] leading-snug text-muted-foreground">
                        {entry.hint}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="text-sm font-medium text-foreground">Language</span>
                <LanguageSelect
                  onChange={(code) => update("language", code)}
                  value={values.language}
                />
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  The language the text is written in. One template per language.
                </p>
              </div>

              <div>
                <span className="text-sm font-medium text-foreground" id="template-format">
                  Parameters
                </span>
                <div
                  aria-labelledby="template-format"
                  className="mt-1.5 grid grid-cols-2 gap-2"
                  role="radiogroup"
                >
                  {FORMATS.map((entry) => {
                    const active = values.parameterFormat === entry.value;

                    return (
                      <label
                        className={cn(
                          "cursor-pointer rounded-lg border px-3 py-2.5 transition-colors",
                          "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/30",
                          active
                            ? "border-brand bg-brand-soft/60"
                            : "border-border hover:bg-accent",
                        )}
                        key={entry.value}
                      >
                        <input
                          checked={active}
                          className="sr-only"
                          name="template-format"
                          onChange={() => update("parameterFormat", entry.value)}
                          type="radio"
                          value={entry.value}
                        />
                        <span className="block text-[13.5px] font-medium text-foreground">
                          {entry.label}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                          {entry.hint}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section
          description="The body is the only required part. Header and footer are optional."
          step={2}
          title="Content"
        >
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="template-header">Header</Label>
                <Counter max={LIMITS.headerMax} value={values.header.trim().length} />
              </div>
              <input
                autoComplete="off"
                className={cn(FIELD, "h-11")}
                id="template-header"
                onChange={(event) => update("header", event.target.value)}
                placeholder="Order update"
                type="text"
                value={values.header}
              />
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-muted-foreground">Type:</span>
                {["Text", "Image", "Video", "Document"].map((kind) => (
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11.5px]",
                      kind === "Text"
                        ? "border-brand/30 bg-brand-soft text-brand"
                        : "cursor-not-allowed border-border bg-secondary text-muted-foreground",
                    )}
                    key={kind}
                    title={
                      kind === "Text"
                        ? undefined
                        : "A media header needs the file uploaded to Meta first, which this build does not do yet."
                    }
                  >
                    {kind}
                  </span>
                ))}
                <span className="text-[11.5px] text-muted-foreground">
                  Media headers need an upload this build does not do yet.
                </span>
              </div>
              <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                Text headers are the only kind this build can submit.
              </p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                {headerTokens.length > 0
                  ? "A header carries at most one variable."
                  : `One line, ${LIMITS.headerMax} characters. A variable would look like ${format.sample}.`}
              </p>
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="template-body">Body</Label>
                <Counter max={LIMITS.bodyMax} value={values.body.trim().length} />
              </div>
              <textarea
                className={cn(FIELD, "min-h-32 resize-y py-2.5 leading-relaxed")}
                id="template-body"
                onChange={(event) => update("body", event.target.value)}
                placeholder="Hi! Your order has shipped and arrives on Tuesday."
                rows={6}
                value={values.body}
              />
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                Line breaks are kept. Personalise with{" "}
                <span className="font-mono text-foreground">{format.sample}</span> —
                every variable needs an example below.
              </p>
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="template-footer">Footer</Label>
                <Counter max={LIMITS.footerMax} value={values.footer.trim().length} />
              </div>
              <input
                autoComplete="off"
                className={cn(FIELD, "h-11")}
                id="template-footer"
                onChange={(event) => update("footer", event.target.value)}
                placeholder="Reply STOP to opt out"
                type="text"
                value={values.footer}
              />
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                Small grey line under the body. No variables here.
              </p>
            </div>
          </div>
        </Section>

        <Section
          description="Meta checks each variable against a real sample before it renders the message."
          step={3}
          title="Examples"
        >
          {tokens.length > 0 ? (
            <ExampleFields
              examples={values.examples}
              format={values.parameterFormat}
              onChange={setExample}
              tokens={tokens}
            />
          ) : (
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              No variables yet. Add{" "}
              <span className="font-mono text-foreground">{format.sample}</span> to the
              header or body and it appears here.
            </p>
          )}
        </Section>

        <Section
          description="A tap, a link, a call or a code. Optional, up to ten."
          step={4}
          title="Buttons"
        >
          <ButtonList buttons={buttons} onChange={setButtons} />
        </Section>

        <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <Button asChild variant="ghost">
            <Link href="/workspace/templates">
              <ArrowLeft aria-hidden="true" />
              Cancel
            </Link>
          </Button>

          <Button disabled={pending} size="lg" type="submit" variant="brand">
            {pending ? (
              <>
                <LoaderCircle aria-hidden="true" className="animate-spin" />
                Sending to Meta…
              </>
            ) : (
              <>
                <Send aria-hidden="true" />
                Submit for review
              </>
            )}
          </Button>
        </div>
      </div>

      <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <TemplatePreview
          body={values.body}
          buttons={buttons}
          examples={values.examples}
          footer={values.footer}
          header={values.header}
        />
      </aside>
    </form>
  );
}

/** Strips what Meta should not receive: blank fields, and this screen's keys. */
function payloadOf(values: DraftValues, buttons: DraftButton[]): TemplateDraft {
  const examples: Record<string, string> = {};

  for (const token of variablesOf(values.header, values.body)) {
    examples[token] = values.examples[token]?.trim() ?? "";
  }

  const clean: TemplateButton[] = buttons.map((button) => {
    const next: TemplateButton = { type: button.type };

    if (button.text?.trim()) next.text = button.text.trim();
    if (button.url?.trim()) next.url = button.url.trim();
    if (button.urlExample?.trim()) next.urlExample = button.urlExample.trim();
    if (button.phoneNumber?.trim()) next.phoneNumber = button.phoneNumber.trim();
    if (button.codeExample?.trim()) next.codeExample = button.codeExample.trim();

    return next;
  });

  return {
    name: values.name.trim(),
    category: values.category,
    language: values.language,
    parameterFormat: values.parameterFormat,
    body: values.body.trim(),
    ...(values.header.trim() ? { header: values.header.trim() } : {}),
    ...(values.footer.trim() ? { footer: values.footer.trim() } : {}),
    ...(clean.length > 0 ? { buttons: clean } : {}),
    ...(Object.keys(examples).length > 0 ? { examples } : {}),
  };
}

function Section({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[11.5px] font-semibold text-muted-foreground">
          {step}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  const over = value > max;

  return (
    <span
      className={cn(
        "text-[11.5px] tabular-nums",
        over ? "font-medium text-destructive" : "text-muted-foreground/70",
      )}
    >
      {value}/{max}
    </span>
  );
}
