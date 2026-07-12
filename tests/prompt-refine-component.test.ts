import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PromptRefineControls", () => {
  it("có preview/undo và gửi context mode", () => {
    const source = readFileSync("src/components/PromptRefineControls.tsx", "utf8");
    expect(source).toContain('fetch("/api/prompt-refine"');
    expect(source).toContain("Gợi ý cải thiện");
    expect(source).toContain("Hoàn tác");
    expect(source).toContain("originalPrompt");
    expect(source).toContain("mode,");
    expect(source).toContain("onPromptChange");
  });
});
