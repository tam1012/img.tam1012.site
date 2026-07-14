import { describe, expect, it } from "vitest";
import { summarizeSession } from "./session.js";

describe("summarizeSession", () => {
  it("summarizes an authenticated ya29 session without leaking the token", () => {
    expect(summarizeSession({ access_token: "ya29.secret", expires: "2026-07-14T00:00:00Z" })).toEqual({
      authenticated: true,
      tokenFamily: "ya29",
      hasExpiry: true,
    });
  });

  it("never includes the raw token value in the summary", () => {
    const serialized = JSON.stringify(summarizeSession({ access_token: "ya29.secret" }));
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("ya29.secret");
  });

  it("reports unauthenticated when there is no access token", () => {
    expect(summarizeSession({})).toEqual({
      authenticated: false,
      tokenFamily: null,
      hasExpiry: false,
    });
  });

  it("classifies non-ya29 tokens as an opaque family", () => {
    expect(summarizeSession({ access_token: "1//other-token" })).toEqual({
      authenticated: true,
      tokenFamily: "opaque",
      hasExpiry: false,
    });
  });
});
