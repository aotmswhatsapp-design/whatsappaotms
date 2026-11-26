import { ImageIcon } from "lucide-react";

import { buttonLabel } from "@/lib/templates/shape";
import { TemplateBubble } from "@/components/workspace/template-bubble";

import type { HeaderFormat, TemplateButton } from "../api";
import { fillVariables } from "../format";

/**
 * A note budget, a body and a stack of buttons — the shape WhatsApp renders
 * for a template, at phone scale.
 *
 * Variables are replaced with the examples the user typed, because a preview
 * showing `{{1}}` is a preview of the form, not of the message. Anything still
 * unfilled stays visible, which is the honest signal that a field is missing.
 *
 * The bubble itself lives in `components/workspace/template-bubble` because the
 * inbox panel draws the same one: one component, so the two screens cannot
 * disagree about what a template looks like.
 */
export function TemplatePreview({
  header,
  headerFormat,
  imageUrl,
  body,
  footer,
  buttons,
  examples,
}: {
  header: string;
  headerFormat: HeaderFormat;
  /** The sample just uploaded, or null while the header is still empty. */
  imageUrl: string | null;
  body: string;
  footer: string;
  buttons: TemplateButton[];
  examples: Record<string, string>;
}) {
  // `IMAGE` is the only header that arrives as a picture; every other piece of
  // chrome is the bubble's business, not this screen's.
  const image = headerFormat === "IMAGE";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Preview</h2>
        <p className="text-[12px] text-muted-foreground">Examples filled in</p>
      </div>

      <div className="mt-3">
        <TemplateBubble
          body={body.trim() ? fillVariables(body.trim(), examples) : ""}
          buttons={buttons.map(buttonLabel)}
          footer={footer.trim() ? fillVariables(footer.trim(), examples) : null}
          header={
            !image && header.trim()
              ? fillVariables(header.trim(), examples)
              : null
          }
          media={
            image ? (
              imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt="The template's header image"
                  className="mb-1 aspect-[1.91/1] w-full rounded-md object-cover"
                  src={imageUrl}
                />
              ) : (
                <div className="mb-1 grid aspect-[1.91/1] place-items-center rounded-md bg-[#d1d7db]">
                  <ImageIcon aria-hidden="true" className="size-5 text-[#5b6b73]" />
                </div>
              )
            ) : null
          }
        />
      </div>

      {buttons.length > 3 ? (
        <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">
          More than three buttons: WhatsApp shows the first two and puts the rest
          behind “See all options”.
        </p>
      ) : null}

      <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">
        The green bar and bubble are WhatsApp&apos;s own chrome, shown so the
        message is judged at the size it arrives.
      </p>
    </div>
  );
}
