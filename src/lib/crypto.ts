import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env";

/**
 * AES-256-GCM envelope for secrets at rest (PRD §4.7). Ciphertext format:
 * `v1:<iv b64>:<authTag b64>:<data b64>` — the version prefix doubles as a
 * key id so a future key rotation can decrypt old rows.
 */

function key(): Buffer {
  if (!env.CREDENTIALS_ENCRYPTION_KEY) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY is not configured");
  }
  const k = Buffer.from(env.CREDENTIALS_ENCRYPTION_KEY, "base64");
  if (k.length !== 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 32 bytes base64");
  return k;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

export function decryptSecret(ciphertext: string): string {
  const [version, ivB64, tagB64, dataB64] = ciphertext.split(":");
  if (version !== "v1") throw new Error(`Unknown ciphertext version: ${version}`);
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
