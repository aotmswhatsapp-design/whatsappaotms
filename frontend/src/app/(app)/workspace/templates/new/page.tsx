import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workspace/page-header";
import { getNavItem } from "@/config/workspace-nav";
import { TemplateBuilder } from "@/features/templates/components/template-builder";

const nav = getNavItem("/workspace/templates");

export const metadata: Metadata = { title: "New template" };

export default function NewTemplatePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <Button asChild variant="outline">
            <Link href="/workspace/templates">
              <ArrowLeft />
              All templates
            </Link>
          </Button>
        }
        description="Write the message, see it the way a customer will, then send it to Meta. Nothing reaches a customer until Meta approves the template."
        eyebrow={nav.group}
        title="New template"
      />

      <TemplateBuilder />
    </div>
  );
}
