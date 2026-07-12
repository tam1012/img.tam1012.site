import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("prompt refine pages", () => {
  it("Edit dùng shared refine ở mode edit", () => {
    const source = readFileSync("src/app/edit/page.tsx", "utf8");
    expect(source).toContain("PromptRefineControls");
    expect(source).toContain('mode="edit"');
  });

  it("Video dùng shared refine ở mode video", () => {
    const source = readFileSync("src/app/video/page.tsx", "utf8");
    expect(source).toContain("PromptRefineControls");
    expect(source).toContain('mode="video"');
  });
});
