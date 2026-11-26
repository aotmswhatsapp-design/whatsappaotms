"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, LayoutTemplate, Loader2, SendHorizontal } from "lucide-react";

import { TemplateBubble } from "@/components/workspace/template-bubble";
import { TemplateImage } from "@/components/workspace/template-image";

import {
  ApiError,
  fetchSendableTemplates,
  sendTemplate,
  type InboxMessage,
  type SendableTemplate,
} from "../api";
import { buttonLabel, fill, shapeOf } from "@/lib/templates/shape";
import type { ComposerMode } from "./mode-switcher";

/** Meta's rule: only an approved template can be sent to a customer. */
const APPROVED = "APPROVED";

/**
 * Sending an approved template from a thread.
 *
 * This is the path that works after the 24-hour window has closed, so the
 * panel deliberately ignores `windowOpen`. Everything it asks for comes from
 * the template's own components: the tokens Meta will fill, the URL buttons
 * that carry a variable, and — only when the template has a URL button — the
 * `tap_target_configuration` override.
 */
export function TemplatePanel({
  conversationId,
  locked,
  onModeChange,
  onSent,
}: {
  conversationId: string;
  locked: boolean;
  onModeChange: (mode: ComposerMode) => void;
  onSent: (message: InboxMessage) => void;
}) {
  const [templates, setTemplates] = React.useState<SendableTemplate[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState("");
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [buttonUrls, setButtonUrls] = React.useState<Record<string, string>>({});
  const [tappable, setTappable] = React.useState(false);
  const [tapTitle, setTapTitle] = React.useState("");
  const [tapUrl, setTapUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * Fetching happens in the promise callbacks only: an effect that sets state
   * synchronously would re-render the whole thread panel on open.
   */
  const load = React.useCallback(() => {
    fetchSendableTemplates()
      .then((payload) =>
        setTemplates(payload.templates.filter((row) => row.status === APPROVED)),
      )
      .catch((cause: unknown) => {
        setLoadError(
          cause instanceof ApiError ? cause.message : "Could not load templates.",
        );
      });
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  function retry(): void {
    setLoadError(null);
    setTemplates(null);
    load();
  }

  const selected = templates?.find((row) => row.id === selectedId) ?? null;
  const shape = React.useMemo(() => shapeOf(selected?.components), [selected]);

  const tokensFilled = shape.tokens.every((token) => values[token]?.trim());
  const linksFilled = shape.urlButtons
    .filter((button) => button.hasVariable)
    .every((button) =>
      /^https?:\/\//i.test(buttonUrls[String(button.index)]?.trim() ?? ""),
    );
  const tapFilled =
    !tappable ||
    (tapTitle.trim().length > 0 && /^https?:\/\//i.test(tapUrl.trim()));

  const ready =
    selected !== null && tokensFilled && linksFilled && tapFilled && !busy;

  function choose(id: string): void {
    setSelectedId(id);
    setValues({});
    setButtonUrls({});
    setTappable(false);
    setTapTitle("");
    setTapUrl("");
    setError(null);
  }

  /**
   * The tap target opens the first URL button's destination, so its address is
   * offered as the override's default rather than asking for the same link
   * twice.
   */
  function toggleTappable(next: boolean): void {
    setTappable(next);

    if (!next || tapUrl.trim()) return;

    const first = shape.urlButtons[0];

    if (first) {
      const filled = buttonUrls[String(first.index)]?.trim();
      setTapUrl(filled || first.url);
    }
  }

  async function submit(): Promise<void> {
    if (!selected || !ready) return;

    setBusy(true);
    setError(null);

    try {
      const { message } = await sendTemplate(conversationId, {
        templateId: selected.id,
        variables: values,
        buttonUrls,
        ...(tappable
          ? { tapTarget: { url: tapUrl.trim(), title: tapTitle.trim() } }
          : {}),
      });

      onSent(message);
      onModeChange("reply");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not send that template. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Send a template"
      className="rounded-xl border border-border bg-card p-2"
    >
      {/* The composer owns the way back to a sentence and the mode switch;
          this panel is only the template's own form. The footer still pins to
          the panel's bottom so Send stays reachable while the body scrolls. */}
      <div>
        {templates === null && !loadError ? (
          <p className="flex h-8 items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            Loading approved templates…
          </p>
        ) : null}

        {loadError ? (
          <div className="flex h-8 min-w-0 items-center gap-2 text-[11.5px] text-destructive">
            <span className="min-w-0 flex-1 truncate">{loadError}</span>
            <button
              type="button"
              className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
              onClick={retry}
            >
              Retry
            </button>
          </div>
        ) : null}

        {templates?.length === 0 ? (
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            No approved templates yet.{" "}
            <Link
              className="font-medium text-brand underline-offset-2 hover:underline"
              href="/workspace/templates"
            >
              Check the templates page
            </Link>
            .
          </p>
        ) : null}

        {/* `appearance-none` strips the browser's own arrow, so the panel
            draws one: without it the field reads as a label rather than as the
            one control that picks a template. */}
        {templates && templates.length > 0 ? (
          <div className="relative">
            <select
              aria-label="Template"
              className="h-8 w-full min-w-0 appearance-none truncate rounded-lg border border-border bg-secondary pr-7 pl-2.5 text-[11.5px] font-medium text-foreground outline-none transition-colors focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
              disabled={busy}
              name="template"
              value={selectedId}
              onChange={(event) => choose(event.target.value)}
            >
              <option value="">Pick an approved template…</option>
              {templates.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} · {row.language}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
          </div>
        ) : null}
      </div>

      {selected ? (
        <>
          {/* The bubble fills the panel on purpose. A squeezed preview hides
              the three things an agent checks before a send — how the body
              wraps, what the buttons say, and whether the footer fits. Nothing
              is clamped: a long body grows and the composer's own scroll
              reaches the rest of it. */}
          <div className="mt-2">
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              <LayoutTemplate aria-hidden="true" className="size-3" />
              Preview
            </p>

            <TemplateBubble
              body={shape.body ? fill(shape.body, values) : ""}
              buttons={shape.buttons.map(buttonLabel)}
              footer={shape.footer ? fill(shape.footer, values) : null}
              header={
                shape.header && shape.headerKind !== "IMAGE"
                  ? fill(shape.header, values)
                  : null
              }
              media={
                shape.headerKind === "IMAGE" ? (
                  <TemplateImage
                    alt={`Sample image for ${selected.name}`}
                    className="mb-1 aspect-[1.91/1] w-full rounded-md"
                    hasMedia={selected.hasMedia}
                    templateId={selected.id}
                  />
                ) : null
              }
            />
          </div>

          {shape.tokens.length > 0 ? (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {shape.tokens.map((token) => (
                <label key={token} className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {`{{${token}}}`}
                  </span>
                  <input
                    className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 text-[11.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
                    disabled={busy}
                    name={`variable-${token}`}
                    placeholder="Value"
                    value={values[token] ?? ""}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [token]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          ) : null}

          {shape.urlButtons
            .filter((button) => button.hasVariable)
            .map((button) => (
              <label key={button.index} className="mt-1.5 block">
                <span className="text-[10.5px] font-medium text-muted-foreground">
                  Button link
                </span>
                <input
                  className="mt-0.5 h-8 w-full rounded-lg border border-border bg-card px-2 text-[11.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
                  disabled={busy}
                  name={`button-url-${button.index}`}
                  placeholder={button.url}
                  value={buttonUrls[String(button.index)] ?? ""}
                  onChange={(event) =>
                    setButtonUrls((current) => ({
                      ...current,
                      [String(button.index)]: event.target.value,
                    }))
                  }
                />
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  Approved pattern: {button.url}
                </span>
              </label>
            ))}

          {shape.urlButtons.length > 0 ? (
            <div className="mt-2 rounded-lg border border-border/70 px-2.5 py-2">
              <label className="flex items-center gap-2 text-[11.5px] font-medium text-foreground">
                <input
                  checked={tappable}
                  className="size-3.5 accent-brand"
                  disabled={busy}
                  type="checkbox"
                  onChange={(event) => toggleTappable(event.target.checked)}
                />
                Make the whole message tappable
              </label>

              {tappable ? (
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                  <input
                    aria-label="Tap target title"
                    className="h-8 min-w-0 rounded-lg border border-border bg-card px-2 text-[11.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
                    disabled={busy}
                    name="tap-target-title"
                    placeholder="Title, e.g. Offer details"
                    value={tapTitle}
                    onChange={(event) => setTapTitle(event.target.value)}
                  />
                  <input
                    aria-label="Tap target address"
                    className="h-8 min-w-0 rounded-lg border border-border bg-card px-2 text-[11.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-brand/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
                    disabled={busy}
                    name="tap-target-url"
                    placeholder="https://…"
                    value={tapUrl}
                    onChange={(event) => setTapUrl(event.target.value)}
                  />
                </div>
              ) : null}

              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                Customers see a button with your title. It opens the first URL
                button&apos;s destination.
              </p>
            </div>
          ) : null}
        </>
      ) : null}

      {error ? (
        <p className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 mt-2 flex flex-wrap items-center justify-between gap-2 bg-card pt-1">
        <p className="min-w-0 text-[10px] leading-relaxed text-muted-foreground">
          {locked
            ? "Allowed outside the 24-hour window — that is what a template is for."
            : "The customer receives the previewed message as it stands."}
        </p>
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-brand px-3 text-[11.5px] font-semibold text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          disabled={!ready}
          onClick={() => void submit()}
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <SendHorizontal aria-hidden="true" className="size-3.5" />
          )}
          Send template
        </button>
      </div>
    </section>
  );
}
