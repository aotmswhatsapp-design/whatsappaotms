"use client";

import { fill, type TemplateShape } from "@/lib/templates/shape";

import type { TokenBinding } from "../api";

/**
 * What one recipient will read.
 *
 * Static bindings show their text. Contact bindings show the sample the form
 * has (a real name and number from the audience) or, when it has none, the
 * fallback the sender would use — never a `{{token}}`, which would be a
 * preview of the form instead of the message.
 *
 * There is no phone chrome here: the Templates module already owns that
 * mockup, and this one is judged for its words and its buttons.
 */
export function CampaignPreview({
  shape,
  bindings,
  buttonUrls,
  sample,
}: {
  shape: TemplateShape;
  bindings: Record<string, TokenBinding>;
  buttonUrls: Record<string, string>;
  sample: { name: string | null; waId: string } | null;
}) {
  const values = previewValues(shape, bindings, sample);
  const header = shape.header ? fill(shape.header, values).trim() : "";
  const body = fill(shape.body, values).trim();
  const footer = shape.footer ? fill(shape.footer, values).trim() : "";

  return (
    <div className="rounded-xl border border-border bg-secondary/60 p-3">
      <div className="ml-auto max-w-[92%] space-y-1 rounded-lg rounded-tr-none bg-card px-3 py-2 shadow-sm">
        {header ? (
          <p className="text-[13.5px] leading-snug font-semibold whitespace-pre-wrap text-foreground">
            {header}
          </p>
        ) : null}

        <p className="text-[13.5px] leading-[1.45] whitespace-pre-wrap text-foreground">
          {body}
        </p>

        {footer ? (
          <p className="text-[11.5px] leading-snug whitespace-pre-wrap text-muted-foreground">
            {footer}
          </p>
        ) : null}

        <p className="flex items-center justify-end pt-0.5 text-[10px] text-muted-foreground">
          now
        </p>
      </div>

      {shape.urlButtons.map((button) => {
        // A URL button with a variable sends the whole address the campaign
        // stored; only a fixed one is known from the template alone.
        const address =
          buttonUrls[String(button.index)]?.trim() || fill(button.url, values);

        return (
          <div
            className="mt-2 ml-auto max-w-[92%] rounded-lg bg-card px-3 py-2 shadow-sm"
            key={`${button.index}-${button.url}`}
          >
            <p className="text-center text-[13px] font-medium text-brand">
              {button.text ?? "Open link"}
            </p>
            <p className="mt-0.5 truncate text-center text-[10.5px] text-muted-foreground">
              {address}
            </p>
          </div>
        );
      })}

      <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
        {sample
          ? `Shown with a real recipient: ${nameOf(sample)} · ${sample.waId}`
          : "The name and number are examples until the audience is chosen."}
      </p>
    </div>
  );
}

/** The values a send would use, for a recipient we can only sample. */
function previewValues(
  shape: TemplateShape,
  bindings: Record<string, TokenBinding>,
  sample: { name: string | null; waId: string } | null,
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const token of shape.tokens) {
    const binding = bindings[token];

    if (!binding) continue;

    if (binding.kind === "static") {
      values[token] = binding.value;
    } else if (binding.field === "name") {
      values[token] = sample?.name ?? binding.fallback ?? "";
    } else {
      values[token] = sample?.waId ?? "919876543210";
    }
  }

  return values;
}

function nameOf(sample: { name: string | null; waId: string }): string {
  return sample.name?.trim() || "No saved name";
}
