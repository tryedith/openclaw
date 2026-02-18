/**
 * AES-256-GCM encryption/decryption for gateway tokens.
 * Key is sourced from GATEWAY_TOKEN_ENCRYPTION_KEY env var (64 hex chars = 32 bytes).
 * ENCRYPTION_KEY is accepted as a legacy fallback.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

function getEncryptionKey(): Buffer {
  const keyHex =
    process.env.GATEWAY_TOKEN_ENCRYPTION_KEY?.trim() || process.env.ENCRYPTION_KEY?.trim();
  if (!keyHex) {
    throw new Error(
      "GATEWAY_TOKEN_ENCRYPTION_KEY (or ENCRYPTION_KEY) environment variable is not set. " +
        "Generate one with: openssl rand -hex 32"
    );
  }
  if (keyHex.length !== 64) {
    throw new Error(
      "Gateway encryption key must be exactly 64 hex characters (32 bytes)"
    );
  }
  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypt a gateway token using AES-256-GCM.
 * Returns base64(iv + ciphertext + authTag).
 */
export function encryptGatewayToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Concatenate: iv (12) + ciphertext (variable) + authTag (16)
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined.toString("base64");
}

/**
 * Decrypt a gateway token encrypted with encryptGatewayToken.
 * Expects base64(iv + ciphertext + authTag).
 */
export function decryptGatewayToken(encrypted: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(encrypted, "base64");

  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted token: too short");
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
