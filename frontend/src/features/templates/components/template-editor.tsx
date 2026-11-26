"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

import {
  ApiError,
  fetchTemplate,
  fetchTemplateMediaUrl,
  type TemplateFacts,
} from "../api";
import { editBlocker } from "../edit-draft";
import { TemplateBuilder } from "./template-builder";

/**
 * The edit route's gate.
 *
 * The builder wants a row it can write whole, so this wrapper reads the row,
 * decides whether this build can, and only then paints the form. A template
 * still in review, disabled by Meta, or carrying a component the builder
 * cannot write gets the reason instead of a form that would fail on submit.
 */
export function TemplateEditor({ id }: { id: string }) {
  const [facts, setFacts] = React.useState<TemplateFacts | null>(null);
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const row = await fetchTemplate(id);
        if (!active) return;

        setFacts(row);

        if (!row.hasMedia) return;

        // A signed URL dies in five minutes, so it is asked for on mount and
        // never stored. Losing it costs the preview only: the path in the row
        // is what the form sends back, and the API re-mints from its own copy.
        try {
          const media = await fetchTemplateMediaUrl(id);
          if (active) setImageUrl(media.url);
        } catch {
          if (active) setImageUrl(null);
        }
      } catch (caught) {
        if (!active) return;

        setError(
          caught instanceof ApiError
            ? caught.message
            : "That template could not be read.",
        );
      }
    })();

    return () => {
      active = false;
    };
  }, [id]);

  if (error) {
    return <Notice body={error} href={`/workspace/templates/${id}`} title="This template could not be read" />;
  }

  if (!facts) {
    return (
      <div className="grid h-64 place-items-center rounded-xl border border-border bg-card">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const blocked = editBlocker(facts);

  if (blocked) {
    return (
      <Notice
        body={blocked}
        href={`/workspace/templates/${id}`}
        title="This template cannot be edited here"
      />
    );
  }

  return <TemplateBuilder editing={{ facts, imageUrl }} />;
}

/** Why the form is not on screen, and the way back to the template itself. */
function Notice({
  title,
  body,
  href,
}: {
  title: string;
  body: string;
  href: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <TriangleAlert aria-hidden="true" className="size-4 text-warning" />
        {title}
      </h2>
      <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
        {body}
      </p>
      <Button asChild className="mt-4" variant="outline">
        <Link href={href}>
          <ArrowLeft />
          Back to template
        </Link>
      </Button>
    </div>
  );
}
