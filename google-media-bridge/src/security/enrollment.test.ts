import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptEnrollment, encryptEnrollment, type EnrollmentPayload } from "./enrollment.js";

function makeKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

const secretToken = "ya29.a0ArThisIsAFakeAccessTokenForTests";
const secretEmail = "canary.tester@example.com";
const secretCookieValue = "S1D-fake-cookie-value-do-not-leak";

function makePayload(issuedAt = new Date().toISOString()): EnrollmentPayload {
  return {
    version: 1,
    issuedAt,
    storageState: {
      cookies: [{ name: "SID", value: secretCookieValue, domain: ".google.com" }],
      origins: [
        {
          origin: "https://labs.google",
          localStorage: [
            { name: "token", value: secretToken },
            { name: "email", value: secretEmail },
          ],
        },
      ],
    },
  };
}

describe("enrollment hybrid decryption (bridge)", () => {
  it("round-trips storage state through RSA-OAEP-SHA256 + AES-256-GCM", () => {
    const { publicKey, privateKey } = makeKeyPair();
    const payload = makePayload();
    const encrypted = encryptEnrollment(payload, publicKey);
    expect(decryptEnrollment(encrypted, privateKey)).toEqual(payload);
  });

  it("never leaks token, email or cookie value into ciphertext", () => {
    const { publicKey } = makeKeyPair();
    const serialized = JSON.stringify(encryptEnrollment(makePayload(), publicKey));
    expect(serialized).not.toContain("ya29");
    expect(serialized).not.toContain(secretToken);
    expect(serialized).not.toContain(secretEmail);
    expect(serialized).not.toContain(secretCookieValue);
  });

  it("rejects a tampered auth tag", () => {
    const { publicKey, privateKey } = makeKeyPair();
    const encrypted = encryptEnrollment(makePayload(), publicKey);
    const tampered = { ...encrypted, ciphertext: Buffer.from("tampered").toString("base64") };
    expect(() => decryptEnrollment(tampered, privateKey)).toThrow();
  });

  it("rejects a bundle older than 10 minutes", () => {
    const { publicKey, privateKey } = makeKeyPair();
    const stale = makePayload(new Date(Date.now() - 11 * 60_000).toISOString());
    const encrypted = encryptEnrollment(stale, publicKey);
    expect(() => decryptEnrollment(encrypted, privateKey)).toThrow();
  });

  it("rejects an unsupported version", () => {
    const { publicKey, privateKey } = makeKeyPair();
    const encrypted = encryptEnrollment(makePayload(), publicKey);
    const wrongVersion = { ...encrypted, version: 2 as unknown as 1 };
    expect(() => decryptEnrollment(wrongVersion, privateKey)).toThrow();
  });
});
