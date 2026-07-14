import { describe, expect, it, vi } from "vitest";
import { createPairingClient } from "./client.js";

describe("pairing client", () => {
  it("starts device and polls until ready without leaking token in errors", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push(url);
      if (url.endsWith("/device")) {
        return {
          status: 200,
          json: async () => ({
            device_code: "dev",
            user_code: "ABCD-1234",
            verification_uri: "https://imgstudio.site/admin/flow-pairing",
            interval: 0,
            expires_in: 600,
          }),
        };
      }
      // first pending, then ready
      if (fetchImpl.mock.calls.length === 2) {
        return { status: 428, json: async () => ({}) };
      }
      expect(String(init?.body || "")).toContain("code_verifier");
      expect(String(init?.body || "")).not.toContain("code_challenge");
      return {
        status: 200,
        json: async () => ({ enrollment_token: "once-token" }),
      };
    });

    const client = createPairingClient({
      baseUrl: "https://imgstudio.site",
      fetchImpl: fetchImpl as never,
      sleep: async () => undefined,
    });
    const device = await client.startDevice();
    expect(device.user_code).toBe("ABCD-1234");
    const token = await client.pollToken(device.device_code, 0);
    expect(token).toEqual({ status: "ready", enrollmentToken: "once-token" });
    expect(JSON.stringify(calls)).not.toContain("once-token");
  });

  it("rejects insecure non-loopback http", () => {
    expect(() => createPairingClient({ baseUrl: "http://example.com" })).toThrow(
      /PAIRING_BASE_URL_INSECURE/,
    );
  });
});
