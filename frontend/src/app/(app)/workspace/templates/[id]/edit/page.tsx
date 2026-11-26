import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workspace/page-header";
import { getNavItem } from "@/config/workspace-nav";
import { TemplateEditor } from "@/features/templates/components/template-editor";

const nav = getNavItem("/workspace/templates");

export const metadata: Metadata = { title: "Edit template" };

/**
 * The id only exists at request time and the row is read with the browser's
 * session token, so this route blocks rather than streaming an empty shell.
 */
export const instant = false;

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <Button asChild variant="outline">
            <Link href={`/workspace/templates/${id}`}>
              <ArrowLeft />
              Back to template
            </Link>
          </Button>
        }
        description="Meta replaces the whole message on an edit, so this screen re-sends every part of it. The name and language are fixed — they are how Meta identifies the template."
        eyebrow={nav.group}
        title="Edit template"
      />

      <TemplateEditor id={id} />
    </div>
  );
}
