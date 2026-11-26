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

import type { ModuleKey } from "./modules";

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
   * The module the owner switches per role. Absent means the page is always
   * reachable — only the Overview takes that path, because every member needs
   * a landing page. The value is matched against the API's registry, so the
   * sidebar and the endpoints behind it cannot disagree about what is open.
   */
  module?: ModuleKey;
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
        module: "inbox",
      },
      {
        title: "Contacts",
        href: "/workspace/contacts",
        description: "Import, tag and manage your contact list",
        icon: Contact,
        module: "contacts",
      },
      {
        title: "QR codes",
        href: "/workspace/qr-codes",
        description: "Codes and short links that open a chat",
        icon: QrCode,
        module: "qr-codes",
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
        module: "campaigns",
      },
      {
        title: "Templates",
        href: "/workspace/templates",
        description: "Meta-approved messages and their variables",
        icon: FileText,
        module: "templates",
      },
      {
        title: "Chatbot",
        href: "/workspace/chatbot",
        description: "Cards a customer walks through, sent from the Inbox",
        icon: Bot,
        module: "chatbot",
      },
      {
        title: "Automations",
        href: "/workspace/automations",
        description: "Triggers, schedules and follow-ups",
        icon: Workflow,
        module: "automations",
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
        module: "ai",
      },
      {
        title: "Analytics",
        href: "/workspace/analytics",
        description: "Delivery, read rates and agent performance",
        icon: BarChart3,
        module: "analytics",
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
        module: "whatsapp",
        statusKey: "whatsapp",
      },
      {
        title: "Team & permissions",
        href: "/workspace/team",
        description: "Invite members, assign roles and choose what each one sees",
        icon: Users,
        module: "team",
      },
      {
        title: "Billing",
        href: "/workspace/billing",
        description: "Plan, usage and invoices",
        icon: CreditCard,
        module: "billing",
      },
      {
        title: "Business profile",
        href: "/workspace/profile",
        description: "Your workspace details and the profile customers see",
        icon: Building2,
        module: "profile",
      },
    ],
  },
];

/** Flattened list for the command palette. */
export const workspaceNavItems = workspaceNav.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.label })),
);

/**
 * The navigation one role may see.
 *
 * Built from the modules the owner switched on rather than from a static
 * route list, and groups left with nothing are dropped so a role never opens
 * a heading with no destinations under it.
 */
export function navForModules(
  modules: readonly ModuleKey[],
): WorkspaceNavGroup[] {
  const allowed = new Set<ModuleKey>(modules);

  return workspaceNav
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => item.module === undefined || allowed.has(item.module),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

/** The same filter, flattened, for the command palette. */
export function navItemsForModules(modules: readonly ModuleKey[]) {
  return navForModules(modules).flatMap((group) =>
    group.items.map((item) => ({ ...item, group: group.label })),
  );
}

/**
 * The module a path opens, if any. Pages outside the registry (`/workspace`
 * itself, `/workspace/join`) answer null and are never gated.
 */
export function moduleForPath(pathname: string): ModuleKey | null {
  const item = workspaceNavItems.find((entry) =>
    isNavItemActive(entry.href, pathname),
  );

  return item?.module ?? null;
}

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
