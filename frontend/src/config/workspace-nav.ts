import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  Building2,
  Contact,
  CreditCard,
  FileText,
  Inbox,
  LayoutDashboard,
  Megaphone,
  PlugZap,
  QrCode,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";

/**
 * Single source of truth for the workspace chrome. The sidebar, the command
 * palette and each page header all read from here, so a module can never be
 * routed in one place and missing from another.
 *
 * The groups mirror the modules in PRD §6; the pages behind them are shells
 * until the matching backend module exists.
 */
export interface WorkspaceNavItem {
  title: string;
  href: string;
  /** Shown in the command palette and as the page subtitle. */
  description: string;
  icon: LucideIcon;
  /**
   * Items that carry a live state show a status dot. Only the WhatsApp item
   * has one today; the value names the feature whose status the shell reads,
   * so the nav stays a plain config module with no imports from `features/`.
   */
  statusKey?: "whatsapp";
}

export interface WorkspaceNavGroup {
  label: string;
  icon: LucideIcon;
  defaultOpen: boolean;
  items: WorkspaceNavItem[];
}

export const workspaceNav: WorkspaceNavGroup[] = [
  {
    label: "Operations",
    icon: LayoutDashboard,
    defaultOpen: true,
    items: [
      {
        title: "Overview",
        href: "/workspace",
        description: "Account health, connection status and recent activity",
        icon: LayoutDashboard,
      },
      {
        title: "Inbox",
        href: "/workspace/inbox",
        description: "Every WhatsApp conversation in one queue",
        icon: Inbox,
      },
      {
        title: "Contacts",
        href: "/workspace/contacts",
        description: "Import, tag and manage your contact list",
        icon: Contact,
      },
      {
        title: "QR codes",
        href: "/workspace/qr-codes",
        description: "Codes and short links that open a chat",
        icon: QrCode,
      },
    ],
  },
  {
    label: "Engagement",
    icon: Megaphone,
    defaultOpen: true,
    items: [
      {
        title: "Campaigns",
        href: "/workspace/campaigns",
        description: "Send approved templates to segmented lists",
        icon: Megaphone,
      },
      {
        title: "Templates",
        href: "/workspace/templates",
        description: "Meta-approved messages and their variables",
        icon: FileText,
      },
      {
        title: "Chatbot",
        href: "/workspace/chatbot",
        description: "Keyword rules that answer before an agent does",
        icon: Bot,
      },
      {
        title: "Automations",
        href: "/workspace/automations",
        description: "Triggers, schedules and follow-ups",
        icon: Workflow,
      },
    ],
  },
  {
    label: "Intelligence",
    icon: Sparkles,
    defaultOpen: false,
    items: [
      {
        title: "AI assistant",
        href: "/workspace/ai",
        description: "Suggested replies, summaries and a knowledge base",
        icon: Sparkles,
      },
      {
        title: "Analytics",
        href: "/workspace/analytics",
        description: "Delivery, read rates and agent performance",
        icon: BarChart3,
      },
    ],
  },
  {
    label: "Settings",
    icon: Building2,
    // Kept open so the connection module is discoverable from anywhere in the
    // workspace; a collapsed group reads as "nothing here".
    defaultOpen: true,
    items: [
      {
        title: "WhatsApp",
        href: "/workspace/whatsapp",
        description: "Connect your WhatsApp Business account",
        icon: PlugZap,
        statusKey: "whatsapp",
      },
      {
        title: "Team",
        href: "/workspace/team",
        description: "Invite agents and assign roles",
        icon: Users,
      },
      {
        title: "Billing",
        href: "/workspace/billing",
        description: "Plan, usage and invoices",
        icon: CreditCard,
      },
      {
        title: "Business profile",
        href: "/workspace/profile",
        description: "Your workspace details and the profile customers see",
        icon: Building2,
      },
    ],
  },
];

/** Flattened list for the command palette. */
export const workspaceNavItems = workspaceNav.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.label })),
);

/**
 * Page headers read their title, group and description from the nav config so
 * a module can never be renamed in one place and left stale in another.
 */
export function getNavItem(href: string): WorkspaceNavItem & { group: string } {
  const item = workspaceNavItems.find((entry) => entry.href === href);
  if (!item) throw new Error(`No workspace nav entry registered for ${href}`);
  return item;
}

/**
 * `/workspace` would otherwise prefix-match every other route, so the overview
 * is compared exactly and the rest match their subtree.
 */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === "/workspace") return pathname === "/workspace";
  return pathname === href || pathname.startsWith(`${href}/`);
}
