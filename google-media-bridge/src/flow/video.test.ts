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
    expect(mapVideoModelKey(4)).toBe("abra_t2v_4s");
  });
});
