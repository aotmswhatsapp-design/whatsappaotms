import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** Marks the ciphertext format so a future key rotation can tell versions apart. */
const VERSION = "v1";
const IV_BYTES = 12; // GCM standard nonce length.

/**
 * Envelope encryption for credentials that must survive a database leak.
 *
 * AES-256-GCM is authenticated, so a tampered ciphertext fails to open instead
 * of decrypting into garbage. The key is derived from one environment secret
 * rather than stored alongside the data — rotating that secret invalidates
 * every stored token, which is the intended failure mode.
 */
@Injectable()
export class SecretBox {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.get<string>("WHATSAPP_ENCRYPTION_KEY");

    if (!secret || secret.length < 32) {
      throw new Error(
        "WHATSAPP_ENCRYPTION_KEY is missing or shorter than 32 characters",
      );
    }

    this.key = createHash("sha256").update(secret).digest();
  }

  /** `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
  seal(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      VERSION,
      iv.toString("base64url"),
      tag.toString("base64url"),
      data.toString("base64url"),
    ].join(".");
  }

  /** Throws on a wrong key, a truncated payload, or tampering. */
  open(payload: string): string {
    const parts = payload.split(".");

    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error("Unrecognised ciphertext format");
    }

    const [, iv, tag, data] = parts;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  /**
   * The only representation of a secret that is allowed to leave the server:
   * enough to recognise which token it is, useless on its own.
   */
  hint(plain: string): string {
    const tail = plain.slice(-4);
    return tail.length === 4 ? `••••${tail}` : "••••";
  }
}
