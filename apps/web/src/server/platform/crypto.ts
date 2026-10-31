import crypto from "node:crypto";
import { getEnv } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function deriveKey(rawKey: string): Buffer {
  return crypto.createHash("sha256").update(rawKey, "utf8").digest();
}

/**
 * Encrypts sensitive secrets (such as TOTP Base32 keys) at rest using AES-256-GCM
 * with APP_ENCRYPTION_KEY (Phase 7 security requirement).
 */
export function encryptSecret(
  plaintext: string,
  encryptionKey: string = getEnv().APP_ENCRYPTION_KEY,
): string {
  const key = deriveKey(encryptionKey);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(
  ciphertext: string,
  encryptionKey: string = getEnv().APP_ENCRYPTION_KEY,
): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted secret payload.");
  }
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const key = deriveKey(encryptionKey);
  const iv = Buffer.from(ivB64, "base64url");
  const authTag = Buffer.from(tagB64, "base64url");
  const encrypted = Buffer.from(dataB64, "base64url");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function generateRecoveryCodes(count = 8): string[] {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(8);
    let part1 = "";
    let part2 = "";
    for (let j = 0; j < 4; j++) {
      part1 += alphabet[(bytes[j] ?? 0) % alphabet.length];
      part2 += alphabet[(bytes[j + 4] ?? 0) % alphabet.length];
    }
    codes.push(`ORDQ-${part1}-${part2}`);
  }
  return codes;
}

