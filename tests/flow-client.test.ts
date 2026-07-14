import { describe, expect, it, vi } from "vitest";
import { createFlowVideoViaRoute, generateFlowImageViaRoute } from "@/lib/flow-client";

describe("flow client", () => {
  it("calls image generations with resolved route", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ b64_json: "aaa" }] }),
    }));
    const images = await generateFlowImageViaRoute({
      prompt: "apple",
      env: {
        FLOW_IMAGE_ROUTE: "direct",
        FLOW_BRIDGE_BASE_URL: "http://bridge.local/v1",
        FLOW_BRIDGE_API_KEY: "k".repeat(32),
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(images).toEqual([{ b64_json: "aaa" }]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const firstCall = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = firstCall;
    expect(url).toBe("http://bridge.local/v1/images/generations");
    expect(String((init.headers as Record<string, string>).Authorization)).toContain("Bearer");
  });

  it("fails closed when disabled", async () => {
    await expect(
      generateFlowImageViaRoute({
        prompt: "x",
        env: { FLOW_IMAGE_ROUTE: "disabled" },
      }),
    ).rejects.toThrow(/FLOW_DISABLED/);
  });

  it("creates video job via route", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ request_id: "job-1" }),
    }));
    const result = await createFlowVideoViaRoute({
      prompt: "cat",
      env: {
        FLOW_VIDEO_ROUTE: "cpa",
        FLOW_CPA_VIDEO_BASE_URL: "http://sidecar/v1",
        FLOW_CPA_VIDEO_API_KEY: "v".repeat(32),
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ request_id: "job-1" });
  });
});
