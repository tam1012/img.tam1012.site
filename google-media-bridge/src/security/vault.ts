import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type VaultEnvelope = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

export function encryptJSON(key: Buffer, value: unknown): string {
  if (key.length !== 32) throw new Error("vault key must be 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const envelope: VaultEnvelope = {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return JSON.stringify(envelope);
}

export function decryptJSON<T = unknown>(key: Buffer, envelopeRaw: string): T {
  if (key.length !== 32) throw new Error("vault key must be 32 bytes");
  let envelope: VaultEnvelope;
  try {
    envelope = JSON.parse(envelopeRaw) as VaultEnvelope;
  } catch {
    throw new Error("invalid vault envelope");
  }
  if (envelope.version !== 1) throw new Error("unsupported vault version");
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as T;
}
