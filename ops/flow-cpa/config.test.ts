import { describe, expect, it } from "vitest";
import { removeFlowProvider, upsertFlowProvider } from "./config";

const existing = [
  { name: "existing", "base-url": "https://example.invalid/v1", models: [{ name: "old" }] },
];

describe("upsertFlowProvider", () => {
  it("adds one isolated image provider and preserves every existing entry", () => {
    const next = upsertFlowProvider(existing, "b".repeat(32));
    expect(next[0]).toEqual(existing[0]);
    expect(next.filter((item) => item.name === "google-flow-bridge")).toHaveLength(1);
    expect(next.at(-1)).toMatchObject({
      name: "google-flow-bridge",
      "base-url": "http://google-media-bridge:8460/v1",
      models: [{ name: "flow-nano-banana-2", alias: "flow-nano-banana-2", image: true }],
    });
  });

  it("is idempotent and rollback removes only Flow", () => {
    const once = upsertFlowProvider(existing, "b".repeat(32));
    const twice = upsertFlowProvider(once, "c".repeat(32));
    expect(twice.filter((item) => item.name === "google-flow-bridge")).toHaveLength(1);
    expect(removeFlowProvider(twice)).toEqual(existing);
  });

  it("rejects short or multiline keys", () => {
    expect(() => upsertFlowProvider(existing, "short")).toThrow();
    expect(() => upsertFlowProvider(existing, `${"b".repeat(32)}\n`)).toThrow();
  });
});
