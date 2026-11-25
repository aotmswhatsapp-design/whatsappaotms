import { ImageIcon } from "lucide-react";

import type { HeaderFormat, TemplateButton } from "../api";
import { fillVariables } from "../format";

/**
 * A note budget, a body and a stack of buttons — the shape WhatsApp renders
 * for a template, at phone scale.
 *
 * Variables are replaced with the examples the user typed, because a preview
 * showing `{{1}}` is a preview of the form, not of the message. Anything still
 * unfilled stays visible, which is the honest signal that a field is missing.
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
  // WhatsApp collapses more than three buttons: two stay visible and the rest
  // move behind "See all options".
  const collapsed = buttons.length > 3;
  const shown = collapsed ? buttons.slice(0, 2) : buttons;
  const image = headerFormat === "IMAGE";
  const empty =
    !header.trim() &&
    !image &&
    !body.trim() &&
    !footer.trim() &&
    buttons.length === 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Preview</h2>
        <p className="text-[12px] text-muted-foreground">Examples filled in</p>
      </div>

      <div className="mt-3 overflow-hidden rounded-3xl border border-border shadow-sm">
        <div className="flex items-center gap-2 bg-[#008069] px-3 py-2.5 text-white">
          <span aria-hidden="true" className="text-lg leading-none">
            ‹
          </span>
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-full bg-white/25 text-[11px] font-semibold"
          >
            B
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">Your business</p>
            <p className="text-[10.5px] text-white/75">online</p>
          </div>
          <span aria-hidden="true" className="text-base leading-none">
            ⋮
          </span>
        </div>

        <div className="space-y-2 bg-[#efeae2] px-3 py-5">
          <p className="mx-auto w-fit rounded-md bg-white/85 px-2 py-1 text-[10.5px] text-[#667781] shadow-sm">
            Today
          </p>

          {empty ? (
            <p className="rounded-lg bg-white px-3 py-2.5 text-[13px] leading-relaxed text-[#667781] shadow-sm">
              Your message appears here as you type.
            </p>
          ) : (
            <div className="ml-auto max-w-[92%] rounded-lg rounded-tr-none bg-white px-2.5 py-2 shadow-sm">
              {image ? (
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
              ) : header.trim() ? (
                <p className="text-[13.5px] leading-snug font-semibold whitespace-pre-wrap text-[#111b21]">
                  {fillVariables(header.trim(), examples)}
                </p>
              ) : null}

              {body.trim() ? (
                <p
                  className={
                    header.trim() || image
                      ? "mt-1 text-[13.5px] leading-[1.45] whitespace-pre-wrap text-[#111b21]"
                      : "text-[13.5px] leading-[1.45] whitespace-pre-wrap text-[#111b21]"
                  }
                >
                  {fillVariables(body.trim(), examples)}
                </p>
              ) : null}

              {footer.trim() ? (
                <p className="mt-1.5 text-[11.5px] leading-snug whitespace-pre-wrap text-[#667781]">
                  {footer.trim()}
                </p>
              ) : null}

              <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-[#667781]">
                <span className="tabular-nums">now</span>
                <span aria-hidden="true" className="text-[#53bdeb]">
                  ✓✓
                </span>
              </p>
            </div>
          )}

          {shown.map((button, index) => (
            <div
              className="flex items-center justify-center rounded-lg bg-white px-3 py-2 text-center text-[13px] font-medium text-[#00a5f4] shadow-sm"
              key={`${button.type}-${index}`}
            >
              {buttonLabel(button)}
            </div>
          ))}

          {collapsed ? (
            <div className="flex items-center justify-center rounded-lg bg-white px-3 py-2 text-center text-[13px] font-medium text-[#00a5f4] shadow-sm">
              See all options
            </div>
          ) : null}
        </div>
      </div>

      {collapsed ? (
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

function buttonLabel(button: TemplateButton): string {
  if (button.type === "COPY_CODE") return "Copy code";
  if (button.type === "PHONE_NUMBER") return button.text?.trim() || "Call";
  if (button.type === "URL") return button.text?.trim() || "Open link";

  return button.text?.trim() || "Quick reply";
}
