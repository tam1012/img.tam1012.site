import { describe, expect, it } from "vitest";
import {
  interpretPollResponse,
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
    expect(mapVideoModelKey("flow-omni-flash", 4, "text_video")).toBe("abra_t2v_4s");
    expect(mapVideoModelKey("flow-omni-flash", 6, "text_video")).toBe("abra_t2v_6s");
    expect(mapVideoModelKey("flow-omni-flash", 8, "text_video")).toBe("abra_t2v_8s");
    expect(mapVideoModelKey("flow-omni-flash", 10, "text_video")).toBe("abra_t2v_10s");
    expect(mapVideoModelKey("flow-omni-flash", 10, "image_video")).toBe("abra_i2v_10s");
    expect(mapVideoModelKey("flow-omni-flash", 8, "start_end_video")).toBe("abra_i2v_8s");
  });
});

describe("interpretPollResponse", () => {
  it("returns null for empty operations so caller can try another payload", () => {
    expect(interpretPollResponse(JSON.stringify({ operations: [] }))).toBeNull();
    expect(interpretPollResponse(JSON.stringify({ remainingCredits: 1 }))).toBeNull();
    expect(interpretPollResponse("not-json")).toBeNull();
  });

  it("maps ACTIVE to pending 60", () => {
    const r = interpretPollResponse(
      JSON.stringify({
        operations: [
          {
            operation: { name: "ops/1" },
            status: "MEDIA_GENERATION_STATUS_ACTIVE",
            mediaGenerationId: "mg-1",
          },
        ],
        remainingCredits: 10,
      }),
    );
    expect(r).toEqual({ status: "pending", progress: 60 });
  });

  it("maps SUCCESSFUL + fifeUrl to done", () => {
    const r = interpretPollResponse(
      JSON.stringify({
        operations: [
          {
            status: "MEDIA_GENERATION_STATUS_SUCCESSFUL",
            operation: {
              done: true,
              metadata: {
                video: { fifeUrl: "https://example.com/video.mp4?fife=1" },
              },
            },
          },
        ],
      }),
    );
    expect(r?.status).toBe("done");
    if (r?.status === "done") {
      expect(r.videoUrl).toContain("example.com/video.mp4");
      expect(r.progress).toBe(100);
    }
  });

  it("maps HIGH_TRAFFIC error to failed with detail", () => {
    const r = interpretPollResponse(
      JSON.stringify({
        operations: [
          {
            status: "MEDIA_GENERATION_STATUS_FAILED",
            operation: {
              done: true,
              error: { message: "PUBLIC_ERROR_HIGH_TRAFFIC" },
            },
          },
        ],
      }),
    );
    expect(r).toEqual({
      status: "failed",
      error: "PUBLIC_ERROR_HIGH_TRAFFIC",
      progress: 100,
    });
  });
});
