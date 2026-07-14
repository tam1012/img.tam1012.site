import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPKCE } from "./pkce.js";

describe("createPKCE", () => {
  it("creates a RFC 7636 S256 verifier and challenge", () => {
    const { verifier, challenge } = createPKCE();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });
});
