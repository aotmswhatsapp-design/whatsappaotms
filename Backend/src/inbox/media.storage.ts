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

/** Metadata calls: a bucket check, a sign, a delete, a listing. */
const TIMEOUT_MS = 30_000;

/** Anything that moves up to 25 MB of bytes, each way. */
const TRANSFER_TIMEOUT_MS = 120_000;

/**
 * One code for every storage refusal, so a client can tell "the bucket is not
 * there" from "this API broke" without reading the sentence.
 */
const STORAGE_UNAVAILABLE = "STORAGE_UNAVAILABLE";

/**
 * Which bucket an instance writes to. A module that wants its own bucket
 * provides this token; one that does not gets the inbox bucket, which keeps
 * `InboxModule` unaware that a second bucket exists.
 *
 * Either a bare name (private, the default) or a name plus visibility: a card
 * picture is read by Meta long after the upload, so its bucket is public and
 * the stored URL never expires.
 */
export const MEDIA_BUCKET = Symbol("MEDIA_BUCKET");

export interface MediaBucket {
  name: string;
  /** Public buckets serve objects without a signature; the URL never expires. */
  public?: boolean;
}

/**
 * Supabase Storage over its REST API.
 *
 * No SDK: this file needs three calls (create the bucket, upload, sign) and
 * `@supabase/supabase-js` would be a dependency for nothing. A bucket is
 * private by default, so the only way out is a short-lived signed URL — which
 * is also what lets an `<img>` tag load a file without carrying a bearer
 * token. A module that asks for a public bucket instead gets a permanent
 * address, because its reader is Meta, not this app.
 */
@Injectable()
export class MediaStorage {
  private readonly logger = new Logger(MediaStorage.name);
  private readonly base: string | null;
  private readonly key: string | null;
  private readonly bucket: string;
  private readonly isPublic: boolean;
  private bucketChecked = false;

  constructor(
    config: ConfigService,
    // A second constructor parameter is a token rather than a type on purpose:
    // a bare optional `string` would make Nest try to resolve a `String`
    // provider for every module that registers this class.
    @Optional() @Inject(MEDIA_BUCKET) bucket?: string | MediaBucket,
  ) {
    const url = (config.get<string>("SUPABASE_URL") ?? "").replace(/\/+$/, "");
    const key =
      config.get<string>("SUPABASE_SERVICE_ROLE_KEY") ??
      config.get<string>("SUPABASE_SECRET_KEY") ??
      "";

    const ready = url.length > 0 && key.length > 0;
    const chosen = typeof bucket === "string" ? { name: bucket } : bucket;

    this.base = ready ? url : null;
    this.key = ready ? key : null;
    this.bucket =
      chosen?.name ??
      config.get<string>("INBOX_MEDIA_BUCKET") ??
      "inbox-media";
    this.isPublic = chosen?.public === true;
  }

  get configured(): boolean {
    return this.base !== null && this.key !== null;
  }

  async upload(path: string, bytes: Buffer, mime: string): Promise<void> {
    const { base } = this.required();

    await this.ensureBucket();

    const response = await this.send(
      "store the file",
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
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      throw this.unavailable(
        `Could not store the file (storage answered ${response.status}).`,
      );
    }
  }

  async signedUrl(path: string): Promise<string> {
    const { base } = this.required();

    const response = await this.send(
      "prepare the file for download",
      `${base}/storage/v1/object/sign/${this.bucket}/${path}`,
      {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({ expiresIn: SIGNED_TTL_SECONDS }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      signedURL?: string;
    } | null;

    if (!response.ok || !payload?.signedURL) {
      throw this.unavailable("Could not prepare the file for download.");
    }

    return `${base}/storage/v1${payload.signedURL}`;
  }

  /**
   * The permanent address of an object in a public bucket.
   *
   * Public because the reader is not this app: a card picture is fetched by
   * Meta when the customer is shown the card, which may be weeks after the
   * upload, and a five-minute signature would be long dead.
   */
  publicUrl(path: string): string {
    const { base } = this.required();

    if (!this.isPublic) {
      throw this.unavailable(
        `The “${this.bucket}” bucket is private, so it has no public address.`,
      );
    }

    return `${base}/storage/v1/object/public/${this.bucket}/${path}`;
  }

  /**
   * The object path inside one of this bucket's public addresses, or null for
   * a URL somebody else serves.
   *
   * A card picture is written into the flow as a public URL, so re-reading the
   * path from it is what lets the sent message keep a stored copy: the thread
   * draws media through a signed link, and a row with no path would claim the
   * picture is gone. A pasted address from elsewhere answers null, and the row
   * keeps the link instead.
   */
  pathInPublicUrl(url: string): string | null {
    const { base } = this;

    if (!this.isPublic || !base) return null;

    const prefix = `${base}/storage/v1/object/public/${this.bucket}/`;

    if (!url.startsWith(prefix)) return null;

    const path = url.slice(prefix.length).split(/[?#]/u)[0];

    return path.length > 0 ? path : null;
  }

  /**
   * The object's bytes, read back with the service key.
   *
   * This is what lets a template sample be re-sent to Meta on a retry: our copy
   * is the durable one, and Meta's handle is not.
   */
  async download(path: string): Promise<Buffer> {
    const { base } = this.required();

    const response = await this.send(
      "read the stored file",
      `${base}/storage/v1/object/${this.bucket}/${path}`,
      {
        headers: this.headers(),
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      throw this.unavailable(
        `Could not read the stored file (storage answered ${response.status}).`,
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Best effort unless a caller says otherwise.
   *
   * The inbox and templates delete as a side effect of something the user already
   * asked for, so a storage hiccup must not fail their request. A caller that has
   * to know — a delete whose object would otherwise be garbage nobody can name
   * again — passes `strict` and gets a 503 instead of a log line. `strict` covers
   * every way the delete can fail, including a request that never answered.
   */
  async remove(
    paths: string[],
    options: { strict?: boolean } = {},
  ): Promise<void> {
    if (paths.length === 0) return;

    if (!this.configured) {
      if (options.strict) {
        throw this.unavailable("Media storage is not configured on this server.");
      }
      return;
    }

    const { base } = this.required();

    const what =
      paths.length === 1
        ? "delete the stored file"
        : `delete ${paths.length} objects`;

    try {
      const response = await this.send(
        what,
        `${base}/storage/v1/object/${this.bucket}`,
        {
          method: "DELETE",
          headers: { ...this.headers(), "content-type": "application/json" },
          body: JSON.stringify({ prefixes: paths }),
          // A request that never answers parks the caller for ever otherwise (B-1).
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );

      if (response.ok) return;

      const detail = `storage answered ${response.status}`;

      if (options.strict) {
        throw this.unavailable(`Could not delete the stored file (${detail}).`);
      }

      this.logger.warn(`Could not delete ${paths.length} object(s): ${detail}`);
    } catch (error) {
      // A timeout or a dead host arrives here, not as a non-OK response. Strict
      // callers must see it: swallowing it is the silent orphan this option is for.
      if (options.strict) throw error;

      // The exception's own sentence already names the operation and the reason;
      // repeating it here read as "Could not delete …: Could not delete …".
      this.logger.warn(
        error instanceof Error ? error.message : "Could not delete the stored file.",
      );
    }
  }

  /**
   * One page of a prefix. Supabase returns `{ name }` entries; `updated_at` is
   * present on real objects and null on folder rows, which the sweeper skips.
   */
  async list(
    prefix: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<{ name: string; updatedAt: string | null }[]> {
    const { base } = this.required();

    const response = await this.send(
      "list stored files",
      `${base}/storage/v1/object/list/${this.bucket}`,
      {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({
          prefix,
          limit: options.limit ?? 100,
          offset: options.offset ?? 0,
          sortBy: { column: "name", order: "asc" },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      throw this.unavailable(
        `Could not list stored files (storage answered ${response.status}).`,
      );
    }

    const rows = (await response.json().catch(() => [])) as {
      name?: string;
      updated_at?: string | null;
    }[];

    return rows
      .filter(
        (row): row is { name: string; updated_at?: string | null } =>
          Boolean(row.name),
      )
      .map((row) => ({ name: row.name, updatedAt: row.updated_at ?? null }));
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketChecked) return;

    const { base } = this.required();

    const response = await this.send(
      "create the media bucket",
      `${base}/storage/v1/bucket`,
      {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({
          id: this.bucket,
          name: this.bucket,
          public: this.isPublic,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    // 400/409 means the bucket already exists, which is the normal case after
    // the first upload. Anything else is worth a line, not a failed message.
    if (!response.ok && response.status !== 400 && response.status !== 409) {
      this.logger.warn(
        `Could not create the media bucket (storage answered ${response.status}).`,
      );
    }

    this.bucketChecked = true;
  }

  /**
   * One place a storage request is made, so no call can forget the rule: a fetch
   * that never answers rejects with `TimeoutError` from `AbortSignal.timeout`,
   * and a bare rejection would reach the global filter as a 500 that blames this
   * process for a bucket that is down.
   */
  private async send(
    action: string,
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw this.unavailable(
        `Could not ${action} (${isTimeout(error) ? "storage did not answer in time" : "storage could not be reached"}).`,
      );
    }
  }

  /** Every refusal this class raises: 503, and one code the client can switch on. */
  private unavailable(message: string): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: STORAGE_UNAVAILABLE,
      message,
    });
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.key as string,
      authorization: `Bearer ${this.key as string}`,
    };
  }

  private required(): { base: string; key: string } {
    if (!this.base || !this.key) {
      throw this.unavailable("Media storage is not configured on this server.");
    }

    return { base: this.base, key: this.key };
  }
}

/** `AbortSignal.timeout` rejects with `TimeoutError`; older runtimes say `AbortError`. */
function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}
