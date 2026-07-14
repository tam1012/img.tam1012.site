import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("google media bridge compose", () => {
  it("binds loopback only, joins external networks, and avoids literal secrets", () => {
    const compose = readFileSync("google-media-bridge/docker-compose.bridge.yml", "utf8");
    expect(compose).toContain("127.0.0.1:8460:8460");
    expect(compose).toContain("cliproxyapi_default");
    expect(compose).toContain("img-studio_default");
    expect(compose).toContain("flow-enrollment-private.pem:ro");
    expect(compose).toMatch(/external:\s*true/);
    expect(compose).not.toMatch(/ya29\./);
    expect(compose).not.toMatch(/BEGIN PRIVATE KEY/);
    expect(compose).not.toMatch(/FLOW_BRIDGE_API_KEY:\s*["']?[a-zA-Z0-9]{20,}/);
  });
});
