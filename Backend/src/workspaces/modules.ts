/**
 * The workspace modules an owner can switch on or off for a role.
 *
 * One list, one order: the sidebar, the permissions screen and the API guard
 * all read it, so a module can never be visible in the shell and refused by the
 * route it links to. `overview` is deliberately absent — the workspace home is
 * the landing place for every member, and hiding it would leave a role with no
 * first screen.
 *
 * The defaults are the PRD's own division of labour (§3.4): a Manager runs
 * campaigns, owns contacts and reads analytics; a Support Agent works the
 * inbox; an Admin runs the product minus the one thing only the owner may do,
 * which is connect the WhatsApp number.
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

/** Ownership is not a toggle: an OWNER sees every module by definition. */
export type ConfigurableRole = "ADMIN" | "MANAGER" | "AGENT";

export const CONFIGURABLE_ROLES: readonly ConfigurableRole[] = [
  "ADMIN",
  "MANAGER",
  "AGENT",
];

/**
 * What each role gets before the owner changes anything.
 *
 * The inbox is the one module every role keeps: two people who cannot see a
 * conversation cannot run a support desk, and the PRD gives the Manager
 * assignment and the Agent the queue.
 */
export const MODULE_DEFAULTS: Record<ConfigurableRole, readonly ModuleKey[]> = {
  ADMIN: [
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
    "billing",
    "profile",
  ],
  MANAGER: ["inbox", "contacts", "campaigns", "analytics"],
  AGENT: ["inbox"],
};

/** The words a 403 uses; the frontend has its own, richer labels. */
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
  whatsapp: "WhatsApp connection",
  billing: "Billing",
  profile: "Business profile",
};

/** Every module, in registry order — what an owner sees. */
export const ALL_MODULES: readonly ModuleKey[] = MODULE_KEYS;

/** A stored or posted key, or null when it is not a module this build knows. */
export function moduleIn(value: unknown): ModuleKey | null {
  return MODULE_KEYS.find((key) => key === value) ?? null;
}

export function isConfigurableRole(value: unknown): value is ConfigurableRole {
  return CONFIGURABLE_ROLES.some((role) => role === value);
}

/**
 * The modules one role may open.
 *
 * Defaults first, then every stored row laid over them — a module switched off
 * is removed, one switched on is added. Rows naming a module this build does
 * not know are ignored rather than trusted: a renamed module must not conjure a
 * route back into existence. An OWNER answers with the whole registry without
 * touching the database.
 */
export function effectiveModules(
  role: string,
  rows: readonly { module: string; enabled: boolean }[],
): ModuleKey[] {
  if (role === "OWNER") return [...ALL_MODULES];

  const enabled = new Set<ModuleKey>(
    isConfigurableRole(role) ? MODULE_DEFAULTS[role] : [],
  );

  for (const row of rows) {
    const key = moduleIn(row.module);

    if (!key) continue;

    if (row.enabled) enabled.add(key);
    else enabled.delete(key);
  }

  return MODULE_KEYS.filter((key) => enabled.has(key));
}
