import { describe, expect, it } from "vitest";
import { mapAspectRatio, mapImageModel } from "./image.js";

describe("image adapter mapping", () => {
  it("maps client model and sizes", () => {
    expect(mapImageModel("flow-nano-banana-2")).toBe("NARWHAL");
    expect(mapImageModel("NARWHAL")).toBe("NARWHAL");
    expect(mapImageModel("flow-nano-banana-pro")).toBe("GEM_PIX_2");
    expect(mapImageModel("GEM_PIX_2")).toBe("GEM_PIX_2");
    expect(() => mapImageModel("other")).toThrow(/FLOW_INVALID_REQUEST/);
    expect(mapAspectRatio("1024x1024")).toBe("IMAGE_ASPECT_RATIO_SQUARE");
    expect(mapAspectRatio("1:1")).toBe("IMAGE_ASPECT_RATIO_SQUARE");
    expect(mapAspectRatio("1792x1024")).toBe("IMAGE_ASPECT_RATIO_LANDSCAPE");
    expect(mapAspectRatio("16:9")).toBe("IMAGE_ASPECT_RATIO_LANDSCAPE");
    expect(mapAspectRatio("1024x1792")).toBe("IMAGE_ASPECT_RATIO_PORTRAIT");
    expect(mapAspectRatio("9:16")).toBe("IMAGE_ASPECT_RATIO_PORTRAIT");
  });
});
