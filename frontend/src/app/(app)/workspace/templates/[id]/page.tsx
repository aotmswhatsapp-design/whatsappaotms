import type { Metadata } from "next";

import { TemplateDetail } from "@/features/templates/components/template-detail";

export const metadata: Metadata = { title: "Template" };

/**
 * The id only exists at request time, and everything on the screen is fetched
 * with the browser's session token. Prerendering has nothing to draw, so this
 * route blocks instead of streaming a skeleton of nothing.
 */
export const instant = false;

/**
 * Thin server shell, like the list: the detail screen reads two authenticated
 * endpoints with the browser's session token, so the server only forwards the
 * id and lets the client do the talking.
 */
export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <TemplateDetail id={id} />;
}
