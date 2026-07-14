import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Google Flow package boundaries", () => {
  it("pin bridge/enroller dependencies and never track runtime state", () => {
    const bridge = JSON.parse(readFileSync("google-media-bridge/package.json", "utf8"));
    const enroller = JSON.parse(readFileSync("google-flow-enroller/package.json", "utf8"));
    const ignore = readFileSync(".gitignore", "utf8");

    expect(bridge.dependencies["playwright-core"]).toBe("1.61.1");
    expect(enroller.dependencies["playwright-core"]).toBe("1.61.1");
    expect(ignore).toContain("google-media-bridge/data/");
    expect(ignore).toContain("google-flow-enroller/state/");
    expect(ignore).toContain("*.flow-enrollment");
  });
});
