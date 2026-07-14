import { describe, expect, it } from "vitest";
import { readSession } from "./session-broker.js";

describe("session broker", () => {
  it("exports readSession", () => {
    expect(typeof readSession).toBe("function");
  });

  it("fails closed when session missing", async () => {
    const page = {
      goto: async () => undefined,
      evaluate: async () => ({
        summary: {
          authenticated: false,
          hasAisandbox: false,
          tokenFamily: "none",
          hasExpiry: false,
        },
        accessToken: "",
      }),
    };
    await expect(readSession(page as never)).rejects.toThrow(/FLOW_REAUTH_REQUIRED/);
  });

  it("never puts token into summary", async () => {
    const page = {
      goto: async () => undefined,
      evaluate: async () => ({
        summary: {
          authenticated: true,
          hasAisandbox: true,
          tokenFamily: "ya29",
          hasExpiry: true,
        },
        accessToken: "ya29.secret",
      }),
    };
    const result = await readSession(page as never);
    expect(JSON.stringify(result.summary)).not.toContain("secret");
    expect(result.accessToken).toBe("ya29.secret");
  });
});
