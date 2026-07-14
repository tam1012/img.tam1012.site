import {
  createCipheriv,
  createDecipheriv,
  constants as cryptoConstants,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { z } from "zod";

export type EnrollmentPayload = {
  version: 1;
  issuedAt: string;
  storageState: { cookies: unknown[]; origins: unknown[] };
};

export type EncryptedEnrollment = {
  version: 1;
  encryptedKey: string;
  iv: string;
  authTag: string;
  ciphertext: string;
};

const MAX_BUNDLE_AGE_MS = 10 * 60_000;

const payloadSchema = z.object({
  version: z.literal(1),
  issuedAt: z.string().datetime(),
  storageState: z.object({
    cookies: z.array(z.unknown()),
    origins: z.array(z.unknown()),
  }),
});

export function encryptEnrollment(payload: EnrollmentPayload, publicKeyPem: string): EncryptedEnrollment {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encryptedKey = publicEncrypt(
    { key: publicKeyPem, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    key,
  );
  return {
    version: 1,
    encryptedKey: encryptedKey.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptEnrollment(bundle: EncryptedEnrollment, privateKeyPem: string): EnrollmentPayload {
  if (bundle.version !== 1) throw new Error("Unsupported enrollment version");
  const key = privateDecrypt(
    { key: privateKeyPem, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(bundle.encryptedKey, "base64"),
  );
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(bundle.iv, "base64"));
  decipher.setAuthTag(Buffer.from(bundle.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(bundle.ciphertext, "base64")),
    decipher.final(),
  ]);
  const payload = payloadSchema.parse(JSON.parse(plaintext.toString("utf8")));
  const ageMs = Date.now() - Date.parse(payload.issuedAt);
  if (!Number.isFinite(ageMs) || ageMs > MAX_BUNDLE_AGE_MS || ageMs < -MAX_BUNDLE_AGE_MS) {
    throw new Error("Enrollment bundle expired");
  }
  return payload;
}
