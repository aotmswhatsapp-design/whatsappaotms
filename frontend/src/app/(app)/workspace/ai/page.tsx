import type { Metadata } from "next";

import { AiView } from "@/features/ai-assistant/ai-view";
import { getNavItem } from "@/config/workspace-nav";

const nav = getNavItem("/workspace/ai");

export const metadata: Metadata = { title: nav.title };

export default function AiAssistantPage() {
  return <AiView />;
}
