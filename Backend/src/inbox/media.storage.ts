import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** How long a generated download link stays usable. */
const SIGNED_TTL_SECONDS = 300;

/**
 * Which bucket an instance writes to. A module that wants its own bucket
 * provides this token; one that does not gets the inbox bucket, which keeps
 * `InboxModule` unaware that a second bucket exists.
 */
export const MEDIA_BUCKET = Symbol("MEDIA_BUCKET");

/**
 * Supabase Storage over its REST API.
 *
 * No SDK: this file needs three calls (create the bucket, upload, sign) and
 * `@supabase/supabase-js` would be a dependency for nothing. The bucket is
 * private, so the only way out is a short-lived signed URL — which is also what
 * lets an `<img>` tag load a file without carrying a bearer token.
 */
@Injectable()
export class MediaStorage {
  private readonly logger = new Logger(MediaStorage.name);
  private readonly base: string | null;
  private readonly key: string | null;
  private readonly bucket: string;
  private bucketChecked = false;

  constructor(
    config: ConfigService,
    // A second constructor parameter is a token rather than a type on purpose:
    // a bare optional `string` would make Nest try to resolve a `String`
    // provider for every module that registers this class.
    @Optional() @Inject(MEDIA_BUCKET) bucket?: string,
  ) {
    const url = (config.get<string>("SUPABASE_URL") ?? "").replace(/\/+$/, "");
    const key =
      config.get<string>("SUPABASE_SERVICE_ROLE_KEY") ??
      config.get<string>("SUPABASE_SECRET_KEY") ??
      "";

    const ready = url.length > 0 && key.length > 0;

    this.base = ready ? url : null;
    this.key = ready ? key : null;
    this.bucket =
      bucket ?? config.get<string>("INBOX_MEDIA_BUCKET") ?? "inbox-media";
  }

  get configured(): boolean {
    return this.base !== null && this.key !== null;
  }

  async upload(path: string, bytes: Buffer, mime: string): Promise<void> {
    const { base } = this.required();

    await this.ensureBucket();

    const response = await fetch(
      `${base}/storage/v1/object/${this.bucket}/${path}`,
      {
        method: "POST",
        headers: {
          ...this.headers(),
          "content-type": mime,
          // A retried upload of the same message id must overwrite, not fail.
          "x-upsert": "true",
        },
        body: new Uint8Array(bytes),
      },
    );

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Could not store the file (storage answered ${response.status}).`,
      );
    }
  }

  async signedUrl(path: string): Promise<string> {
    const { base } = this.required();

    const response = await fetch(
      `${base}/storage/v1/object/sign/${this.bucket}/${path}`,
      {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({ expiresIn: SIGNED_TTL_SECONDS }),
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      signedURL?: string;
    } | null;

    if (!response.ok || !payload?.signedURL) {
      throw new ServiceUnavailableException(
        "Could not prepare the file for download.",
      );
    }

    return `${base}/storage/v1${payload.signedURL}`;
  }

  /**
   * The object's bytes, read back with the service key.
   *
   * This is what lets a template sample be re-sent to Meta on a retry: our copy
   * is the durable one, and Meta's handle is not.
   */
  async download(path: string): Promise<Buffer> {
    const { base } = this.required();

    const response = await fetch(
      `${base}/storage/v1/object/${this.bucket}/${path}`,
      { headers: this.headers() },
    );

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Could not read the stored file (storage answered ${response.status}).`,
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /** Best effort: a deleted thread must not fail because storage hiccuped. */
  async remove(paths: string[]): Promise<void> {
    if (paths.length === 0 || !this.configured) return;

    const { base } = this.required();

    await fetch(`${base}/storage/v1/object/${this.bucket}`, {
      method: "DELETE",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    }).catch(() => undefined);
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketChecked) return;

    const { base } = this.required();

    const response = await fetch(`${base}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        id: this.bucket,
        name: this.bucket,
        public: false,
      }),
    });

    // 400/409 means the bucket already exists, which is the normal case after
    // the first upload. Anything else is worth a line, not a failed message.
    if (!response.ok && response.status !== 400 && response.status !== 409) {
      this.logger.warn(
        `Could not create the media bucket (storage answered ${response.status}).`,
      );
    }

    this.bucketChecked = true;
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.key as string,
      authorization: `Bearer ${this.key as string}`,
    };
  }

  private required(): { base: string; key: string } {
    if (!this.base || !this.key) {
      throw new ServiceUnavailableException(
        "Media storage is not configured on this server.",
      );
    }

    return { base: this.base, key: this.key };
  }
}
