import { describe, expect, it } from "vitest";
import {
  assertFlowEnv,
  resolveFlowImageRoute,
  resolveFlowVideoRoute,
} from "@/lib/flow-routing";

describe("flow routing", () => {
  it("routes image through main CPA", () => {
    expect(
      resolveFlowImageRoute({
        FLOW_IMAGE_ROUTE: "cpa",
        FLOW_CPA_IMAGE_BASE_URL: "https://cli.example/v1",
        FLOW_CPA_IMAGE_API_KEY: "k".repeat(32),
      }),
    ).toEqual({
      route: "cpa",
      baseUrl: "https://cli.example/v1",
      apiKey: "k".repeat(32),
      model: "flow-nano-banana-2",
    });
  });

  it("routes video through sidecar when G5 selected cpa", () => {
    expect(
      resolveFlowVideoRoute({
        FLOW_VIDEO_ROUTE: "cpa",
        FLOW_CPA_VIDEO_BASE_URL: "http://flow-cpa-sidecar:8317/v1",
        FLOW_CPA_VIDEO_API_KEY: "v".repeat(32),
      }),
    ).toMatchObject({ route: "cpa", model: "grok-imagine-video" });
  });

  it("fails closed for missing, invalid or disabled config", () => {
    expect(resolveFlowImageRoute({})).toEqual({ route: "disabled" });
    expect(resolveFlowVideoRoute({ FLOW_VIDEO_ROUTE: "cpa" })).toEqual({ route: "disabled" });
    expect(resolveFlowVideoRoute({ FLOW_VIDEO_ROUTE: "disabled" })).toEqual({ route: "disabled" });
    expect(assertFlowEnv({ FLOW_IMAGE_ROUTE: "direct" }).length).toBeGreaterThan(0);
    expect(assertFlowEnv({ FLOW_IMAGE_ROUTE: "disabled" })).toEqual([]);
  });
});
