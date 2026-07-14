import { describe, expect, it } from "vitest";
import { redact, redactText } from "./redact.js";

describe("redact", () => {
  it("removes authorization, cookies, tokens, emails and signed urls", () => {
    const cleaned = redact({
      authorization: "Bearer ya29.abc",
      Cookie: "SID=secret",
      recaptchaToken: "03AGdBq...",
      email: "user@example.com",
      url: "https://cdn.example/file?token=abc&signature=xyz",
      nested: { refresh_token: "r1", ok: true },
    }) as Record<string, unknown>;

    const json = JSON.stringify(cleaned);
    expect(json).not.toContain("ya29");
    expect(json).not.toContain("SID=secret");
    expect(json).not.toContain("user@example.com");
    expect(json).not.toContain("03AGdBq");
    expect(cleaned.nested).toMatchObject({ refresh_token: "[redacted]", ok: true });
  });

  it("redacts free text logs", () => {
    const text = redactText("user=a@b.com token=ya29.hello Authorization: Bearer abc.def");
    expect(text).not.toContain("ya29");
    expect(text).not.toContain("a@b.com");
    expect(text).toContain("[redacted");
  });
});
