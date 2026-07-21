import { describe, expect, it } from "vitest";
import {
  extractMediaGenerationIds,
  extractUploadedImageName,
  mapAspectRatio,
  mapImageModel,
  mapUpsampleResolution,
} from "./image.js";

describe("image adapter mapping", () => {
  it("maps client model and sizes", () => {
    expect(mapImageModel("flow-nano-banana-2")).toBe("NARWHAL");
    expect(mapImageModel("NARWHAL")).toBe("NARWHAL");
    expect(mapImageModel("flow-nano-banana-pro")).toBe("GEM_PIX_2");
    expect(mapImageModel("GEM_PIX_2")).toBe("GEM_PIX_2");
    expect(() => mapImageModel("other")).toThrow(/FLOW_INVALID_REQUEST/);
  });

  it("maps all 5 Flow UI aspect ratios (not just 3 buckets)", () => {
    expect(mapAspectRatio("1:1")).toBe("IMAGE_ASPECT_RATIO_SQUARE");
    expect(mapAspectRatio("16:9")).toBe("IMAGE_ASPECT_RATIO_LANDSCAPE");
    expect(mapAspectRatio("9:16")).toBe("IMAGE_ASPECT_RATIO_PORTRAIT");
    expect(mapAspectRatio("4:3")).toBe("IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE");
    expect(mapAspectRatio("3:4")).toBe("IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR");
    // legacy sizes
    expect(mapAspectRatio("1024x1024")).toBe("IMAGE_ASPECT_RATIO_SQUARE");
    expect(mapAspectRatio("1792x1024")).toBe("IMAGE_ASPECT_RATIO_LANDSCAPE");
    expect(mapAspectRatio("1024x1792")).toBe("IMAGE_ASPECT_RATIO_PORTRAIT");
    // pixel size nearest-bucket (2048x1536 ≈ 4:3)
    expect(mapAspectRatio("2048x1536")).toBe("IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE");
    expect(mapAspectRatio("1536x2048")).toBe("IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR");
  });

  it("maps resolution tier to upsample target (2K/4K only)", () => {
    expect(mapUpsampleResolution("1K")).toBeNull();
    expect(mapUpsampleResolution(undefined)).toBeNull();
    expect(mapUpsampleResolution("2K")).toBe("UPSAMPLE_IMAGE_RESOLUTION_2K");
    expect(mapUpsampleResolution("4K")).toBe("UPSAMPLE_IMAGE_RESOLUTION_4K");
  });

  it("extracts mediaGenerationId for upsample", () => {
    expect(
      extractMediaGenerationIds(
        JSON.stringify({
          media: [{ mediaGenerationId: "mgid-1111-aaaa-bbbb-cccccccccccc" }],
        }),
      ),
    ).toEqual(["mgid-1111-aaaa-bbbb-cccccccccccc"]);
    expect(extractMediaGenerationIds("{not-json")).toEqual([]);
  });

  it("extracts upload media name from common response shapes", () => {
    expect(
      extractUploadedImageName(
        JSON.stringify({ name: "12937080-f270-44c1-8cc6-a7e147be1ce0", mimeType: "image/jpeg" }),
      ),
    ).toBe("12937080-f270-44c1-8cc6-a7e147be1ce0");
    expect(
      extractUploadedImageName(
        JSON.stringify({ media: { mediaId: "abc-media-id-001" }, ok: true }),
      ),
    ).toBe("abc-media-id-001");
    expect(extractUploadedImageName("{not-json")).toBeNull();
  });
});
