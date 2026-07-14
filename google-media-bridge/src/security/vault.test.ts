import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptJSON, encryptJSON } from "./vault.js";

describe("vault", () => {
  it("round-trips secrets without leaking plaintext into ciphertext", () => {
    const key = randomBytes(32);
    const value = {
      access_token: "ya29.secret-token-value",
      cookie: "SID=secret-cookie",
      nested: { email: "user@example.com" },
    };
    const encrypted = encryptJSON(key, value);
    expect(encrypted).not.toContain("ya29");
    expect(encrypted).not.toContain("SID=secret");
    expect(encrypted).not.toContain("user@example.com");
    expect(decryptJSON(key, encrypted)).toEqual(value);
  });

  it("rejects bad auth tags", () => {
    const key = randomBytes(32);
    const encrypted = JSON.parse(encryptJSON(key, { ok: true })) as {
      version: 1;
      iv: string;
      tag: string;
      ciphertext: string;
    };
    encrypted.tag = Buffer.alloc(16, 9).toString("base64");
    expect(() => decryptJSON(key, JSON.stringify(encrypted))).toThrow();
  });
});
