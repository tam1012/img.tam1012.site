import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const valid = {
  FLOW_BRIDGE_API_KEY: "b".repeat(32),
  FLOW_BRIDGE_ADMIN_KEY: "a".repeat(32),
  FLOW_VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
  FLOW_ENROLLMENT_PRIVATE_KEY_FILE: "/run/secrets/flow-enrollment-private.pem",
  FLOW_CHROMIUM_PATH: "/usr/bin/chromium",
  FLOW_DATA_DIR: "/data",
};

describe("loadConfig", () => {
  it("loads valid production config", () => {
    expect(loadConfig(valid)).toMatchObject({ port: 8460, dataDir: "/data" });
  });

  it("rejects short keys and invalid vault key", () => {
    expect(() => loadConfig({ ...valid, FLOW_BRIDGE_API_KEY: "short" })).toThrow();
    expect(() => loadConfig({ ...valid, FLOW_VAULT_KEY: "bad" })).toThrow();
  });

  it("rejects identical media and admin keys", () => {
    expect(() =>
      loadConfig({
        ...valid,
        FLOW_BRIDGE_API_KEY: "x".repeat(32),
        FLOW_BRIDGE_ADMIN_KEY: "x".repeat(32),
      }),
    ).toThrow();
  });
});
