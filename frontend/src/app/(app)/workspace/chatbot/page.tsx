import type { Metadata } from "next";

import { getNavItem } from "@/config/workspace-nav";
import { ChatbotView } from "@/features/chatbot/chatbot-view";

const nav = getNavItem("/workspace/chatbot");

export const metadata: Metadata = { title: nav.title };

export default function ChatbotPage() {
  return <ChatbotView />;
}
