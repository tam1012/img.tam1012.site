import { describe, expect, it } from "vitest";
import { renderSidecarConfig } from "./render-sidecar";

describe("renderSidecarConfig", () => {
  it("renders isolated video sidecar config", () => {
    const yaml = renderSidecarConfig({
      clientKey: "c".repeat(32),
      bridgeKey: "b".repeat(32),
    });
    expect(yaml).toContain("port: 8317");
    expect(yaml).toContain("base-url: http://google-media-bridge:8460/v1");
    expect(yaml).toContain("name: grok-imagine-video");
    expect(yaml).not.toContain("auth-dir: /root/.cli-proxy-api");
  });

  it("rejects multiline keys", () => {
    expect(() =>
      renderSidecarConfig({ clientKey: "bad\nkey", bridgeKey: "b".repeat(32) }),
    ).toThrow();
  });
});
