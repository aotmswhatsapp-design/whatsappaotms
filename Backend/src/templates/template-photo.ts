import { Injectable } from "@nestjs/common";

import { MediaStorage } from "../inbox/media.storage";

/**
 * The stored sample behind a template's media header, as a link Meta can fetch
 * right now.
 *
 * A signed link lives for minutes, so it is minted at send time and never
 * stored: the durable thing is the object path on the template row, and this
 * class is the only place that turns one into the other for a send.
 */
@Injectable()
export class TemplatePhoto {
  constructor(private readonly storage: MediaStorage) {}

  /** Null when the template has no stored sample; throws when storage is down. */
  async linkOf(mediaPath: string | null | undefined): Promise<string | null> {
    if (!mediaPath) return null;

    return this.storage.signedUrl(mediaPath);
  }
}
