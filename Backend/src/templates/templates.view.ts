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
  /**
   * True when we hold a sample for this row's IMAGE header. The card uses it
   * to decide whether asking for a signed URL is worth a request at all.
   */
  hasMedia: boolean;
  /**
   * Where our copy lives. The edit screen seeds the form with it so an image
   * header survives an edit that only rewrote the body — the caller cannot
   * invent the path, and the service re-checks it on the way back in.
   */
  mediaPath: string | null;
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
