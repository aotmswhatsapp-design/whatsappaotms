/** What the templates screen renders, one row per Meta template. */
export interface TemplateFacts {
  id: string;
  metaId: string | null;
  name: string;
  language: string;
  category: string;
  parameterFormat: string;
  status: string;
  qualityScore: string | null;
  rejectedReason: string | null;
  components: unknown;
  createdAt: string;
  updatedAt: string;
}

/**
 * `stale` is not an error: it means the list on screen is the cache, and Meta
 * could not be reached to refresh it. The screen says so instead of showing an
 * empty list, which would read as "your templates were deleted".
 */
export interface TemplateListPayload {
  connected: boolean;
  templates: TemplateFacts[];
  syncedAt: string | null;
  stale: boolean;
  warning?: string;
}
