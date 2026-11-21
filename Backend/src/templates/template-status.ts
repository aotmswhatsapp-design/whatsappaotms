/**
 * `message_template_status_update` deliveries.
 *
 * They are the odd ones out: a message delivery names the number that received
 * it (`value.metadata.phone_number_id`), while a template status names only the
 * **WhatsApp Business Account** in `entry[].id`. Resolving these by number is
 * what made them disappear — there is no number in the payload to resolve.
 *
 * The parser is pure and lives here rather than in the webhook service so the
 * shape of Meta's payload is in one readable place, next to the templates it
 * describes.
 */

export interface TemplateStatusEvent {
  /** The WABA the entry belongs to; matched against `businessAccountId`. */
  wabaId: string;
  templateId: string;
  name: string | null;
  language: string | null;
  /** APPROVED, REJECTED, PAUSED, DISABLED, PENDING_DELETION, … */
  event: string;
  reason: string | null;
}

export function templateStatusEvents(payload: unknown): TemplateStatusEvent[] {
  const events: TemplateStatusEvent[] = [];

  for (const entry of entries(payload)) {
    const wabaId = asString(entry.id);

    if (!wabaId) continue;

    for (const change of changes(entry)) {
      if (change.field !== "message_template_status_update") continue;

      const value = (change.value ?? {}) as Record<string, unknown>;
      const templateId = asString(value.message_template_id);

      // Without an id there is nothing to match on. Anything else can be
      // absent and still be useful, so only this field is required.
      if (!templateId) continue;

      events.push({
        wabaId,
        templateId,
        name: asString(value.message_template_name),
        language: asString(value.message_template_language),
        event: asString(value.event) ?? "PENDING",
        reason: asString(value.reason),
      });
    }
  }

  return events;
}

/** Every WABA an entry names, deduplicated. */
export function wabaIds(payload: unknown): string[] {
  const found = new Set<string>();

  for (const entry of entries(payload)) {
    const id = asString(entry.id);
    if (id) found.add(id);
  }

  return [...found];
}

function entries(payload: unknown): Array<Record<string, unknown>> {
  const list = (payload as { entry?: unknown } | null)?.entry;

  return Array.isArray(list)
    ? list.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null,
      )
    : [];
}

function changes(entry: Record<string, unknown>): Array<{
  field?: string;
  value?: unknown;
}> {
  const list = entry.changes;

  return Array.isArray(list)
    ? list.filter(
        (change): change is { field?: string; value?: unknown } =>
          typeof change === "object" && change !== null,
      )
    : [];
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);

  return null;
}
