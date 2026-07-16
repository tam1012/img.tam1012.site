import { describe, expect, it } from "vitest";
import {
  mapVideoEndpoint,
  mapVideoModelKey,
  resolveVideoKind,
  type CreateVideoInput,
} from "./video.js";

describe("video adapter mapping", () => {
  it("routes three modes and rejects end-only", () => {
    const base: CreateVideoInput = {
      prompt: "a cat walking",
      duration: 4,
      aspectRatio: "16:9",
    };
    expect(resolveVideoKind(base)).toBe("text_video");
    expect(resolveVideoKind({ ...base, startImage: { data: Buffer.from("x"), mimeType: "image/png" } })).toBe(
      "image_video",
    );
    expect(
      resolveVideoKind({
        ...base,
        startImage: { data: Buffer.from("x"), mimeType: "image/png" },
        endImage: { data: Buffer.from("y"), mimeType: "image/png" },
      }),
    ).toBe("start_end_video");
    expect(() =>
      resolveVideoKind({
        ...base,
        endImage: { data: Buffer.from("y"), mimeType: "image/png" },
      }),
    ).toThrow(/FLOW_INVALID_REQUEST/);

    expect(mapVideoEndpoint("text_video")).toContain("batchAsyncGenerateVideoText");
    expect(mapVideoEndpoint("image_video")).toContain("batchAsyncGenerateVideoStartImage");
    expect(mapVideoEndpoint("start_end_video")).toContain("batchAsyncGenerateVideoStartAndEndImage");
    expect(mapVideoModelKey("flow-video-fast-4s")).toBe("abra_t2v_4s");
    expect(mapVideoModelKey("flow-veo-3.1-fast")).toBe("veo_3_1_t2v_fast");
    expect(mapVideoModelKey("flow-veo-3.1-lite")).toBe("veo_3_1_t2v_lite");
    expect(mapVideoModelKey("flow-veo-3.1-quality")).toBe("veo_3_1_t2v_quality");
    expect(mapVideoModelKey()).toBe("veo_3_1_t2v_fast");
  });
});
