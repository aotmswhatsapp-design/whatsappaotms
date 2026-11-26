/**
 * The workspace modules an owner can switch on or off for a role.
 *
 * This mirrors the API's own registry (`Backend/src/workspaces/modules.ts`) in
 * order and spelling. Two apps, one contract: adding a module means adding it
 * here, to the nav item it opens, and to the backend list — the guard would
 * refuse a key it does not know, so drift shows up as a 403 rather than as a
 * screen nobody can reach.
 *
 * `overview` is deliberately absent. The workspace home is every member's
 * landing place, so it is never a toggle.
 */
export const MODULE_KEYS = [
  "inbox",
  "contacts",
  "qr-codes",
  "campaigns",
  "templates",
  "chatbot",
  "automations",
  "ai",
  "analytics",
  "team",
  "whatsapp",
  "billing",
  "profile",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Ownership is not a toggle: an owner sees every module by definition. */
export type ConfigurableRole = "ADMIN" | "MANAGER" | "AGENT";

export const CONFIGURABLE_ROLES: readonly ConfigurableRole[] = [
  "ADMIN",
  "MANAGER",
  "AGENT",
];

/** The PRD's names for the three roles an owner hands out. */
export const ROLE_TITLES: Record<ConfigurableRole, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  AGENT: "Support agent",
};

/** What each role is for, in the words the permissions screen uses. */
export const ROLE_SUMMARIES: Record<ConfigurableRole, string> = {
  ADMIN:
    "Runs the product day to day. Everything except the WhatsApp number itself, which stays with you.",
  MANAGER:
    "Campaigns, contacts and analytics, plus the right to hand conversations to agents.",
  AGENT: "Answers conversations and leaves notes. Sees only their own queue.",
};

/** The words the screen and the 403 use for each module. */
export const MODULE_LABELS: Record<ModuleKey, string> = {
  inbox: "Inbox",
  contacts: "Contacts",
  "qr-codes": "QR codes",
  campaigns: "Campaigns",
  templates: "Templates",
  chatbot: "Chatbot",
  automations: "Automations",
  ai: "AI assistant",
  analytics: "Analytics",
  team: "Team",
  whatsapp: "WhatsApp",
  billing: "Billing",
  profile: "Business profile",
};

/** One line under each toggle, so an owner knows what they are handing over. */
export const MODULE_HINTS: Record<ModuleKey, string> = {
  inbox: "Read and answer customer conversations",
  contacts: "Import, tag and edit the contact list",
  "qr-codes": "Codes and short links that open a chat",
  campaigns: "Build, test and send broadcast campaigns",
  templates: "Submit and edit Meta-approved message templates",
  chatbot: "Write the cards a customer walks through",
  automations: "Triggers, schedules and follow-ups",
  ai: "Agents, training sources and suggested replies",
  analytics: "Delivery, read rates and spend",
  team: "See members and pending invitations",
  whatsapp: "The connected number — read-only for anyone but you",
  billing: "Plan, usage and invoices",
  profile: "The details customers see about the business",
};

/** A stored or posted key, or null when it is not a module this build knows. */
export function moduleIn(value: unknown): ModuleKey | null {
  return MODULE_KEYS.find((key) => key === value) ?? null;
}

export function isConfigurableRole(value: unknown): value is ConfigurableRole {
  return CONFIGURABLE_ROLES.some((role) => role === value);
}
